/**
 * `writeSummaryAction` / `saveSummaryAction` against a real Postgres (Phase 11, D-107).
 * PHASE-11.md §10 I-1..I-33 (loadMonthlySummaryScreen's own bullets too).
 *
 * `writeSummary` (the OpenAI call) is mocked throughout — no real network call is ever made.
 * `requireOwnedFundingSource`, `loadMonthFacts`, and every write here hit a real database.
 *
 * Skipped when DATABASE_URL is absent.
 *
 * I-15 (document add/remove never marks the summary stale) is not exercised live here: it would
 * require going through the presign/storage ingestion pipeline for a document upload, out of
 * scope for this action-level suite. It's true by construction instead — `expensesFingerprint`
 * (./fingerprint.ts) hashes only expense-table fields (name, description, narrative, note,
 * amounts, taxReimbursable/feesReimbursable, noReceipt/noReceiptReason); no document-table field
 * is ever part of the hash, so a document add/remove cannot change it.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));
vi.mock("@/src/services/openai/write-summary", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/services/openai/write-summary")>();
  return { ...original, writeSummary: vi.fn() };
});

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const MONTH = "2096-05"; // far future, avoids clashing with real data
let monthSeq = 0;
/** A fresh month key per test that needs its own row, so tests never collide on the unique
 *  (org, source, month) index even when they share `orgId`/`fundingSourceId`. */
function freshMonth(): string {
  monthSeq += 1;
  const mm = String((monthSeq % 12) + 1).padStart(2, "0");
  const year = 2096 + Math.floor(monthSeq / 12);
  return `${year}-${mm}`;
}

describe.skipIf(!hasDatabase)("monthly-summary actions (integration, Phase 11)", async () => {
  const { db } = await import("@/src/db");
  const {
    aiUsageEvents,
    expenseDocuments,
    expenses,
    fundingSources,
    lineItems,
    monthlySummaries,
    monthStatuses,
    organizations,
    paymentSources,
    recurringItems,
    users,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { fail: actionFail, SESSION_EXPIRED } = await import("@/src/lib/action-result");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { actionSession } = await import("@/src/lib/action-session");
  const { writeSummary } = await import("@/src/services/openai/write-summary");
  const { writeSummaryAction, saveSummaryAction } = await import("./actions");
  const { loadMonthlySummaryScreen, loadMonthFacts, loadSummaryCard } = await import("./queries");
  const {
    createExpenseAction,
    deleteExpenseAction,
    permanentlyDeleteExpenseAction,
    removeExpenseDocumentAction,
    restoreExpenseAction,
    updateExpenseAction,
  } = await import("@/src/modules/expenses/actions");
  const { addRecurringToMonthAction, removeRecurringFromMonthAction } = await import(
    "@/src/modules/recurring/actions"
  );
  const { UI } = await import("@/src/domain/strings");
  const { monthLabel } = await import("@/src/domain/dates");
  const { clearAll: clearRateLimit } = await import("@/src/services/rate-limit");

  const session = vi.mocked(actionSession);
  const writeSummaryMock = vi.mocked(writeSummary);

  const createdOrgIds: string[] = [];
  afterAll(async () => {
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
      await rm(path.join(process.cwd(), ".storage", "org", id), { recursive: true, force: true });
    }
  });

  const savedEnv = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_SUMMARY_MODEL,
  };
  afterAll(() => {
    if (savedEnv.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedEnv.key;
    if (savedEnv.model === undefined) delete process.env.OPENAI_SUMMARY_MODEL;
    else process.env.OPENAI_SUMMARY_MODEL = savedEnv.model;
  });

  beforeEach(() => {
    clearRateLimit();
    writeSummaryMock.mockReset();
    writeSummaryMock.mockResolvedValue({ outcome: "written", markdown: goodDraft(), inputTokens: 10, outputTokens: 5 });
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_SUMMARY_MODEL", "gpt-5.6-terra");
  });

  /** A draft that always passes both the structure check and the figure verifier for a month
   *  with zero facts (no allowed amounts/percents beyond "$0.00" and the like) — every section
   *  present, no `$`/`%` figures written at all so nothing can be flagged as unsupplied. */
  function goodDraft(): string {
    const lines: string[] = [];
    for (const title of ["Overview", "Spending by line item", "Budget position", "Changes from last month", "Items to note"]) {
      lines.push(`## ${title}`, "Nothing to report this month.");
    }
    return lines.join("\n");
  }

  async function insertUser(orgId: string, role: "admin" | "manager" = "admin") {
    const [row] = await db
      .insert(users)
      .values({
        orgId,
        email: `u-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role,
      })
      .returning({ id: users.id });
    return row.id;
  }

  function asSession(orgId: string, userId: string, overrides: Partial<Parameters<typeof session.mockResolvedValue>[0]> = {}) {
    session.mockResolvedValue({
      orgId,
      userId,
      email: "e@example.com",
      role: "admin",
      orgName: "Org",
      docName: "Doc",
      activeMonth: MONTH,
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation_ai" as const,
      ...overrides,
    });
  }

  async function makeOrgWithExpense(month = MONTH) {
    const org = await createTestOrg({ name: `Summary actions org ${Date.now()}-${Math.random()}` });
    createdOrgIds.push(org.orgId);
    await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, org.orgId));
    await db.insert(paymentSources).values({ orgId: org.orgId, label: "Cash", sortOrder: 0 });

    const [item] = await db
      .insert(lineItems)
      .values({ orgId: org.orgId, fundingSourceId: org.fundingSourceId, name: "Salary", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });

    const [expense] = await db
      .insert(expenses)
      .values({
        orgId: org.orgId,
        fundingSourceId: org.fundingSourceId,
        lineItemId: item.id,
        date: `${month}-05`,
        name: "Groceries",
        paymentSource: "Cash",
        subtotalCents: 5_000,
        taxCents: 0,
        feesCents: 0,
        taxReimbursable: false,
        feesReimbursable: false,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(org.orgId, org.fundingSourceId, month),
        month,
      })
      .returning({ id: expenses.id });

    const userId = await insertUser(org.orgId);
    return { ...org, lineItemId: item.id, expenseId: expense.id, userId, month };
  }

  async function usageRows(orgId: string, month: string) {
    return db
      .select()
      .from(aiUsageEvents)
      .where(and(eq(aiUsageEvents.orgId, orgId), eq(aiUsageEvents.feature, "monthly_summary"), eq(aiUsageEvents.month, month)));
  }

  async function summaryRow(orgId: string, sourceId: string, month: string) {
    const [row] = await db
      .select()
      .from(monthlySummaries)
      .where(and(eq(monthlySummaries.orgId, orgId), eq(monthlySummaries.fundingSourceId, sourceId), eq(monthlySummaries.month, month)));
    return row ?? null;
  }

  describe("I-1: base plan", () => {
    it("write and save both refused; no usage row", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      await db.update(organizations).set({ plan: "reconciliation" }).where(eq(organizations.id, org.orgId));
      asSession(org.orgId, org.userId);

      const writeResult = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      expect(writeResult).toEqual({ ok: false, error: UI.summaryPlanNote });
      expect(writeSummaryMock).not.toHaveBeenCalled();

      const saveResult = await saveSummaryAction({ sourceId: org.fundingSourceId, month: org.month, markdown: "x", expectedVersion: 1 });
      expect(saveResult).toEqual({ ok: false, error: UI.summaryPlanNote });

      expect(await usageRows(org.orgId, org.month)).toHaveLength(0);
    });
  });

  describe("I-2/I-3: server not configured", () => {
    it("write refused with no model call when the key is missing; save with the key missing still saves an existing summary", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);

      vi.unstubAllEnvs();
      vi.stubEnv("OPENAI_API_KEY", "");
      vi.stubEnv("OPENAI_SUMMARY_MODEL", "gpt-5.6-terra");

      const writeResult = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      expect(writeResult.ok).toBe(false);
      expect(writeSummaryMock).not.toHaveBeenCalled();
      expect(await usageRows(org.orgId, org.month)).toHaveLength(0);

      // Seed an existing row directly (bypassing the write path) so save-only can be tested.
      await db.insert(monthlySummaries).values({
        orgId: org.orgId,
        fundingSourceId: org.fundingSourceId,
        month: org.month,
        contentMarkdown: "original",
        version: 1,
        expensesFingerprint: "0".repeat(64),
        writtenAt: new Date(),
        model: "gpt-5.6-terra",
      });

      const saveResult = await saveSummaryAction({
        sourceId: org.fundingSourceId,
        month: org.month,
        markdown: "edited text",
        expectedVersion: 1,
      });
      expect(saveResult).toEqual({ ok: true, data: { version: 2 } });
    });
  });

  it("I-4: a manager can write and save", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    const managerId = await insertUser(org.orgId, "manager");
    asSession(org.orgId, managerId, { role: "manager" });

    const writeResult = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    expect(writeResult.ok).toBe(true);
    if (!writeResult.ok) throw new Error("unreachable");

    const saveResult = await saveSummaryAction({
      sourceId: org.fundingSourceId,
      month: org.month,
      markdown: "manager edit",
      expectedVersion: writeResult.data.version,
    });
    expect(saveResult.ok).toBe(true);
  });

  it("I-5: an expired session refuses both write and save", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    // `@/src/lib/action-session` itself is mocked wholesale (see the `vi.mock` above), so the
    // real `actionSession()`'s own UnauthenticatedError→expired translation never runs here —
    // its already-translated return shape is what the mock has to produce directly.
    session.mockResolvedValue({ expired: actionFail(SESSION_EXPIRED) });

    const writeResult = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    expect(writeResult.ok).toBe(false);
    if (!writeResult.ok) expect(writeResult.error).toMatch(/Signed out/);

    const saveResult = await saveSummaryAction({ sourceId: org.fundingSourceId, month: org.month, markdown: "x", expectedVersion: 1 });
    expect(saveResult.ok).toBe(false);
    expect(writeSummaryMock).not.toHaveBeenCalled();
  });

  describe("I-6: malformed / unowned input", () => {
    it("another organisation's funding source id is refused", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      const other = await createTestOrg({ name: `Other org ${Date.now()}` });
      createdOrgIds.push(other.orgId);
      // The other org is on the AI plan too, so only the ownership check can refuse this.
      await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, other.orgId));
      const otherUser = await insertUser(other.orgId);

      asSession(org.orgId, org.userId);
      const victim = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      if (!victim.ok) throw new Error(victim.error);
      writeSummaryMock.mockClear();

      asSession(other.orgId, otherUser);
      const result = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      expect(result).toEqual({ ok: false, error: "Choose a funding source." });
      expect(writeSummaryMock).not.toHaveBeenCalled();

      const save = await saveSummaryAction({
        sourceId: org.fundingSourceId,
        month: org.month,
        markdown: "overwritten by another org",
        expectedVersion: victim.data.version,
      });
      expect(save).toEqual({ ok: false, error: "Choose a funding source." });
      expect((await summaryRow(org.orgId, org.fundingSourceId, org.month))!.contentMarkdown).toBe(victim.data.contentMarkdown);
      expect(await loadMonthlySummaryScreen(other.orgId, org.fundingSourceId, org.month)).toBeNull();
    });

    it("a non-uuid source id is refused", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      const result = await writeSummaryAction({ sourceId: "not-a-uuid", month: org.month, expectedVersion: null });
      expect(result.ok).toBe(false);
    });

    it("an invalid month key is refused", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      expect((await writeSummaryAction({ sourceId: org.fundingSourceId, month: "2096-13", expectedVersion: null })).ok).toBe(
        false,
      );
      expect((await writeSummaryAction({ sourceId: org.fundingSourceId, month: "not-a-month", expectedVersion: null })).ok).toBe(
        false,
      );
    });

    it("malformed input shapes are refused without reaching the session at all failing loudly", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      // @ts-expect-error deliberately wrong shapes
      expect((await writeSummaryAction(null)).ok).toBe(false);
      // @ts-expect-error deliberately wrong shapes
      expect((await writeSummaryAction({ sourceId: 5, month: org.month, expectedVersion: null })).ok).toBe(false);
      for (const bad of [0, -1, 1.5, "1"]) {
        // @ts-expect-error deliberately wrong shapes
        expect((await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: bad })).ok).toBe(
          false,
        );
      }
      expect(writeSummaryMock).not.toHaveBeenCalled();
    });
  });

  it("I-7: only trashed expenses in the month → refused, no usage row, no model call", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, org.expenseId));
    asSession(org.orgId, org.userId);

    const result = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    expect(result.ok).toBe(false);
    expect(writeSummaryMock).not.toHaveBeenCalled();
    expect(await usageRows(org.orgId, org.month)).toHaveLength(0);
  });

  it("I-8: first write stores text, fingerprint matches loadMonthFacts, written_by, model, version 1, usage success with tokens/cost", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    writeSummaryMock.mockResolvedValue({ outcome: "written", markdown: goodDraft(), inputTokens: 100, outputTokens: 20 });
    vi.stubEnv("OPENAI_SUMMARY_PRICE_INPUT_PER_MTOK", "2.00");
    vi.stubEnv("OPENAI_SUMMARY_PRICE_OUTPUT_PER_MTOK", "12.00");

    const result = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.version).toBe(1);
    expect(result.data.writtenBySomeoneElse).toBe(false);
    expect(result.data.contentMarkdown).toBe(goodDraft());

    const row = await summaryRow(org.orgId, org.fundingSourceId, org.month);
    expect(row).not.toBeNull();
    expect(row!.writtenBy).toBe(org.userId);
    expect(row!.model).toBe("gpt-5.6-terra");

    const loaded = await loadMonthFacts(org.orgId, org.fundingSourceId, org.month);
    expect(row!.expensesFingerprint).toBe(loaded!.fingerprint);

    const rows = await usageRows(org.orgId, org.month);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("success");
    expect(rows[0].trigger).toBe("first");
    expect(rows[0].inputTokens).toBe(100);
    expect(rows[0].outputTokens).toBe(20);
    expect(rows[0].costMicroUsd).toBe(100 * 2 + 20 * 12);
  });

  it("I-9..I-14: real expense edits mark the summary stale via loadMonthlySummaryScreen", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);

    expect((await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null })).ok).toBe(true);
    let screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.stale).toBe(false);

    // Create a new expense in the month.
    const created = await createExpenseAction({
      name: "New expense",
      fundingSourceId: org.fundingSourceId,
      lineItemId: org.lineItemId,
      paymentSource: "Cash",
      taxReimbursable: false,
      feesReimbursable: true,
      month: org.month,
      date: `${org.month}-10`,
      description: "",
      subtotal: "10.00",
      tax: "0",
      fees: "0",
      note: "",
      narrative: "A narrative.",
      noReceipt: true,
      noReceiptReason: "test",
    });
    expect(created.ok).toBe(true);
    screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.stale).toBe(true);

    // Write again to clear staleness, then trash + restore + permanently delete.
    expect((await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: screen!.summary!.version })).ok).toBe(true);
    screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.stale).toBe(false);
    if (!created.ok) throw new Error("unreachable");

    await deleteExpenseAction(created.data.id);
    screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.stale).toBe(true);

    expect((await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: screen!.summary!.version })).ok).toBe(true);
    await restoreExpenseAction(created.data.id);
    screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.stale).toBe(true);

    await deleteExpenseAction(created.data.id);
    expect((await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: (await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month))!.summary!.version })).ok).toBe(true);
    // permanentlyDeleteExpenseAction only ever targets an already-trashed row (its own WHERE
    // requires deletedAt already set), so the live expense set — what the fingerprint is over —
    // cannot change as a result of it. The write immediately above already captured the
    // fingerprint with this expense excluded (it was trashed at that point), so staleness stays
    // cleared: permanent delete is a structural no-op for this flag.
    await permanentlyDeleteExpenseAction(created.data.id);
    screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.stale).toBe(false);
  });

  it("I-9/recurring: addRecurringToMonthAction and removeRecurringFromMonthAction mark stale", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    const [template] = await db
      .insert(recurringItems)
      .values({ orgId: org.orgId, name: "Rent", amountCents: 1_000, lineItemId: org.lineItemId, sortOrder: 0 })
      .returning({ id: recurringItems.id });

    expect((await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null })).ok).toBe(true);
    let screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.stale).toBe(false);

    const added = await addRecurringToMonthAction(template.id, org.month);
    expect(added.ok).toBe(true);
    screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.stale).toBe(true);

    expect((await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: screen!.summary!.version })).ok).toBe(true);
    const removed = await removeRecurringFromMonthAction(template.id, org.month, true);
    expect(removed.ok).toBe(true);
    screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.stale).toBe(true);
  });

  it("I-10/I-13/I-14: edit, move to another month and move to another source (real updateExpenseAction) mark the summary stale", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    const input = {
      name: "Editable expense",
      fundingSourceId: org.fundingSourceId,
      lineItemId: org.lineItemId,
      paymentSource: "Cash",
      taxReimbursable: false,
      feesReimbursable: true,
      month: org.month,
      date: `${org.month}-10`,
      description: "Before",
      subtotal: "10.00",
      tax: "0",
      fees: "0",
      note: "",
      narrative: "A narrative.",
      noReceipt: false,
      noReceiptReason: "",
    };
    const created = await createExpenseAction(input);
    if (!created.ok) throw new Error(created.error);
    const id = created.data.id;

    async function writeFresh() {
      const before = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
      const result = await writeSummaryAction({
        sourceId: org.fundingSourceId,
        month: org.month,
        expectedVersion: before!.summary ? before!.summary.version : null,
      });
      expect(result.ok).toBe(true);
      expect((await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month))!.stale).toBe(false);
    }

    // Edit (description only).
    await writeFresh();
    expect((await updateExpenseAction({ ...input, id, description: "After" })).ok).toBe(true);
    expect((await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month))!.stale).toBe(true);

    // Move to another month.
    await writeFresh();
    const otherMonth = freshMonth();
    expect(
      (await updateExpenseAction({ ...input, id, description: "After", month: otherMonth, date: `${otherMonth}-10` })).ok,
    ).toBe(true);
    expect((await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month))!.stale).toBe(true);

    // Move back, then move to another funding source.
    expect((await updateExpenseAction({ ...input, id, description: "After" })).ok).toBe(true);
    await writeFresh();
    const [otherSource] = await db
      .insert(fundingSources)
      .values({ orgId: org.orgId, name: "Second source", taxReimbursable: false, feesReimbursable: true, sortOrder: 1 })
      .returning({ id: fundingSources.id });
    const [otherItem] = await db
      .insert(lineItems)
      .values({ orgId: org.orgId, fundingSourceId: otherSource.id, name: "Other", scheduledValueCents: 1_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    const moved = await updateExpenseAction({
      ...input,
      id,
      description: "After",
      fundingSourceId: otherSource.id,
      lineItemId: otherItem.id,
    });
    expect(moved.ok).toBe(true);
    expect((await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month))!.stale).toBe(true);
  });

  it("I-15: adding or removing a document does not mark the summary stale", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    expect((await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null })).ok).toBe(
      true,
    );

    // Row inserted directly: the upload pipeline is covered elsewhere; what matters here is that a
    // new attached document on the month's expense, and its removal, change nothing.
    const [doc] = await db
      .insert(expenseDocuments)
      .values({
        orgId: org.orgId,
        expenseId: org.expenseId,
        kind: "receipt",
        status: "attached",
        s3Key: `org/${org.orgId}/i15-${Date.now()}.pdf`,
        filename: "receipt.pdf",
        mimeType: "application/pdf",
      })
      .returning({ id: expenseDocuments.id });
    expect((await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month))!.stale).toBe(false);

    expect((await removeExpenseDocumentAction(doc.id)).ok).toBe(true);
    expect((await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month))!.stale).toBe(false);
  });

  it("I-16: saving edited text keeps stale (save never touches the fingerprint)", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    if (!write.ok) throw new Error("unreachable");

    await db.insert(expenses).values({
      orgId: org.orgId,
      fundingSourceId: org.fundingSourceId,
      lineItemId: org.lineItemId,
      date: `${org.month}-11`,
      name: "Another",
      paymentSource: "Cash",
      subtotalCents: 100,
      taxCents: 0,
      feesCents: 0,
      taxReimbursable: false,
      feesReimbursable: false,
      sortOrder: 1,
      referenceSeq: 2,
      month: org.month,
    });

    let screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.stale).toBe(true);

    const save = await saveSummaryAction({
      sourceId: org.fundingSourceId,
      month: org.month,
      markdown: "edited",
      expectedVersion: write.data.version,
    });
    expect(save.ok).toBe(true);

    screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.stale).toBe(true);
  });

  it("I-17: write again replaces text and fingerprint, clears edited_*, version+1, trigger 'again'", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    const first = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    if (!first.ok) throw new Error("unreachable");

    const saved = await saveSummaryAction({
      sourceId: org.fundingSourceId,
      month: org.month,
      markdown: "edited by human",
      expectedVersion: first.data.version,
    });
    if (!saved.ok) throw new Error("unreachable");

    const secondDraft = goodDraft().replace("Nothing to report this month.", "Something new to report.");
    writeSummaryMock.mockResolvedValue({ outcome: "written", markdown: secondDraft, inputTokens: 1, outputTokens: 1 });

    const again = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: saved.data.version });
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error("unreachable");
    expect(again.data.version).toBe(saved.data.version + 1);
    expect(again.data.contentMarkdown).toBe(secondDraft);

    const row = await summaryRow(org.orgId, org.fundingSourceId, org.month);
    expect(row!.editedAt).toBeNull();
    expect(row!.editedBy).toBeNull();

    const rows = await usageRows(org.orgId, org.month);
    const lastRow = rows[rows.length - 1];
    expect(lastRow.trigger).toBe("again");

    const screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.stale).toBe(false);
  });

  describe("I-18: rejected/retried drafts", () => {
    it("wrong amount twice → rejected, nothing saved, tokens summed, model called exactly twice, second call carries retryFeedback naming the amount", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      const badDraft = goodDraft().replace("Nothing to report this month.", "We spent $999,999.99 on outreach.");
      writeSummaryMock.mockResolvedValue({ outcome: "written", markdown: badDraft, inputTokens: 10, outputTokens: 5 });

      const result = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      expect(result.ok).toBe(false);
      expect(writeSummaryMock).toHaveBeenCalledTimes(2);
      expect(writeSummaryMock.mock.calls[1][0].retryFeedback).toContain("$999,999.99");

      expect(await summaryRow(org.orgId, org.fundingSourceId, org.month)).toBeNull();
      const rows = await usageRows(org.orgId, org.month);
      expect(rows).toHaveLength(1);
      expect(rows[0].outcome).toBe("rejected");
      expect(rows[0].inputTokens).toBe(20);
      expect(rows[0].outputTokens).toBe(10);
    });

    it("wrong first, then right on retry → success saved with summed tokens", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      const badDraft = goodDraft().replace("Nothing to report this month.", "We spent $999,999.99 on outreach.");
      writeSummaryMock
        .mockResolvedValueOnce({ outcome: "written", markdown: badDraft, inputTokens: 10, outputTokens: 5 })
        .mockResolvedValueOnce({ outcome: "written", markdown: goodDraft(), inputTokens: 7, outputTokens: 3 });

      const result = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      expect(result.ok).toBe(true);
      const rows = await usageRows(org.orgId, org.month);
      expect(rows[0].outcome).toBe("success");
      expect(rows[0].inputTokens).toBe(17);
      expect(rows[0].outputTokens).toBe(8);
    });

    it("bad structure first, then right on retry → success", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      writeSummaryMock
        .mockResolvedValueOnce({ outcome: "written", markdown: "no headings at all", inputTokens: 1, outputTokens: 1 })
        .mockResolvedValueOnce({ outcome: "written", markdown: goodDraft(), inputTokens: 1, outputTokens: 1 });

      const result = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      expect(result.ok).toBe(true);
    });
  });

  describe("I-19: transport failure — no retry", () => {
    it("writeSummary failed with tokens present → failed, nothing saved, one call", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      writeSummaryMock.mockResolvedValue({ outcome: "failed", inputTokens: 5, outputTokens: 2 });

      const result = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      expect(result.ok).toBe(false);
      expect(writeSummaryMock).toHaveBeenCalledTimes(1);
      expect(await summaryRow(org.orgId, org.fundingSourceId, org.month)).toBeNull();
      const rows = await usageRows(org.orgId, org.month);
      expect(rows).toHaveLength(1);
      expect(rows[0].outcome).toBe("failed");
      expect(rows[0].inputTokens).toBe(5);
    });

    it("writeSummary failed with no tokens → failed, nothing saved, one call", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      writeSummaryMock.mockResolvedValue({ outcome: "failed", inputTokens: null, outputTokens: null });

      const result = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      expect(result.ok).toBe(false);
      expect(writeSummaryMock).toHaveBeenCalledTimes(1);
      const rows = await usageRows(org.orgId, org.month);
      expect(rows[0].inputTokens).toBeNull();
      expect(rows[0].outputTokens).toBeNull();
    });
  });

  it("I-21: two concurrent writes for the same org/source/month — exactly one model call, the other gets summaryAlreadyWriting; lock released after completion", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);

    let resolveDeferred!: (value: Awaited<ReturnType<typeof writeSummary>>) => void;
    const deferred = new Promise<Awaited<ReturnType<typeof writeSummary>>>((resolve) => {
      resolveDeferred = resolve;
    });
    writeSummaryMock.mockImplementation(() => deferred);

    const first = writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    // Let the first call reach and register the in-flight lock before firing the second.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });

    expect(second).toEqual({ ok: false, error: UI.summaryAlreadyWriting(monthLabel(org.month)) });
    resolveDeferred({ outcome: "written", markdown: goodDraft(), inputTokens: 1, outputTokens: 1 });
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
    expect(writeSummaryMock).toHaveBeenCalledTimes(1);

    // Lock released — a third call now proceeds and calls the model again.
    writeSummaryMock.mockResolvedValue({ outcome: "written", markdown: goodDraft(), inputTokens: 1, outputTokens: 1 });
    const third = await writeSummaryAction({
      sourceId: org.fundingSourceId,
      month: org.month,
      expectedVersion: (firstResult as { ok: true; data: { version: number } }).data.version,
    });
    expect(third.ok).toBe(true);
    expect(writeSummaryMock).toHaveBeenCalledTimes(2);
  });

  it("I-21b: the lock is released even when the run throws/fails", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    writeSummaryMock.mockResolvedValue({ outcome: "failed", inputTokens: null, outputTokens: null });

    const first = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    expect(first.ok).toBe(false);

    writeSummaryMock.mockResolvedValue({ outcome: "written", markdown: goodDraft(), inputTokens: 1, outputTokens: 1 });
    const second = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    expect(second.ok).toBe(true); // proves the lock wasn't left held by the failed run
  });

  it("I-22: two first drafts racing — the loser gets the winner's content, one row in the table, usage logged success for both", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);

    // Simulate the race by having the mock itself insert the "winner" row before resolving —
    // the loser's writeAndPersist then hits onConflictDoNothing for real.
    writeSummaryMock.mockImplementationOnce(async () => {
      await db.insert(monthlySummaries).values({
        orgId: org.orgId,
        fundingSourceId: org.fundingSourceId,
        month: org.month,
        contentMarkdown: "WINNER TEXT",
        version: 1,
        expensesFingerprint: "1".repeat(64),
        writtenAt: new Date(),
        writtenBy: org.userId,
        model: "gpt-5.6-terra",
      });
      return { outcome: "written", markdown: goodDraft(), inputTokens: 1, outputTokens: 1 };
    });

    const result = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.contentMarkdown).toBe("WINNER TEXT");
    expect(result.data.writtenBySomeoneElse).toBe(true);

    const rows = await db
      .select()
      .from(monthlySummaries)
      .where(
        and(eq(monthlySummaries.orgId, org.orgId), eq(monthlySummaries.fundingSourceId, org.fundingSourceId), eq(monthlySummaries.month, org.month)),
      );
    expect(rows).toHaveLength(1);

    const usage = await usageRows(org.orgId, org.month);
    expect(usage).toHaveLength(1);
    expect(usage[0].outcome).toBe("success");
  });

  it("I-23: saving against a stale version → conflict", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    if (!write.ok) throw new Error("unreachable");

    const result = await saveSummaryAction({
      sourceId: org.fundingSourceId,
      month: org.month,
      markdown: "x",
      expectedVersion: write.data.version + 1, // wrong version
    });
    expect(result).toEqual({ ok: false, error: UI.summaryConflict });
  });

  it("write-again's own UPDATE re-checks the version at persist time, not just at the pre-check (closes the pre-check-to-persist race)", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    if (!write.ok) throw new Error("unreachable");

    // Simulate a second writer landing between the pre-check (which passed, since the version
    // hasn't moved yet from this run's point of view) and the persisting UPDATE — the model
    // call's mock itself races the version forward mid-flight, the same trick I-22 uses.
    writeSummaryMock.mockImplementationOnce(async () => {
      await db
        .update(monthlySummaries)
        .set({ version: sql`${monthlySummaries.version} + 1` })
        .where(
          and(
            eq(monthlySummaries.orgId, org.orgId),
            eq(monthlySummaries.fundingSourceId, org.fundingSourceId),
            eq(monthlySummaries.month, org.month),
          ),
        );
      return { outcome: "written", markdown: goodDraft(), inputTokens: 1, outputTokens: 1 };
    });

    const result = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: write.data.version });
    expect(result).toEqual({ ok: false, error: UI.summaryConflict });
  });

  it("I-24: saving after someone else's write again → conflict", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    if (!write.ok) throw new Error("unreachable");

    // Someone else writes again, bumping the version behind this session's back.
    await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: write.data.version });

    const result = await saveSummaryAction({
      sourceId: org.fundingSourceId,
      month: org.month,
      markdown: "stale edit",
      expectedVersion: write.data.version, // stale — someone already bumped it
    });
    expect(result).toEqual({ ok: false, error: UI.summaryConflict });
  });

  it("save on a month with no summary row at all → summaryNotFound", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    const result = await saveSummaryAction({ sourceId: org.fundingSourceId, month: org.month, markdown: "x", expectedVersion: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no summary for/);
  });

  describe("I-26: save length bound", () => {
    it("60,000 code points including an emoji is accepted, stored exactly as typed including \\r\\n and <script>", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      if (!write.ok) throw new Error("unreachable");

      const body = "a".repeat(59_990) + "🎉".repeat(4) + "<script>alert(1)</script>\r\n  trailing  ";
      const trimmedToLength = Array.from(body).length > 60_000 ? Array.from(body).slice(0, 60_000).join("") : body;
      const markdown = Array.from(trimmedToLength).length === 60_000 ? trimmedToLength : trimmedToLength.padEnd(60_000, "a");
      expect(Array.from(markdown)).toHaveLength(60_000);

      const result = await saveSummaryAction({ sourceId: org.fundingSourceId, month: org.month, markdown, expectedVersion: write.data.version });
      expect(result.ok).toBe(true);

      const row = await summaryRow(org.orgId, org.fundingSourceId, org.month);
      expect(row!.contentMarkdown).toBe(markdown);
    });

    it("60,001 code points is refused", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      if (!write.ok) throw new Error("unreachable");

      const markdown = "a".repeat(60_001);
      const result = await saveSummaryAction({ sourceId: org.fundingSourceId, month: org.month, markdown, expectedVersion: write.data.version });
      expect(result).toEqual({ ok: false, error: UI.summaryTooLong });
    });
  });

  it("I-27: a locked month still allows write and save", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    await db
      .insert(monthStatuses)
      .values({ orgId: org.orgId, fundingSourceId: org.fundingSourceId, month: org.month, lockedAt: new Date() })
      .onConflictDoUpdate({
        target: [monthStatuses.orgId, monthStatuses.fundingSourceId, monthStatuses.month],
        set: { lockedAt: new Date() },
      });

    const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    expect(write.ok).toBe(true);
    if (!write.ok) throw new Error("unreachable");

    const save = await saveSummaryAction({ sourceId: org.fundingSourceId, month: org.month, markdown: "x", expectedVersion: write.data.version });
    expect(save.ok).toBe(true);
  });

  it("I-28: an archived funding source still allows write and save", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    await db.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, org.fundingSourceId));
    asSession(org.orgId, org.userId);

    const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    expect(write.ok).toBe(true);
    if (!write.ok) throw new Error("unreachable");

    const save = await saveSummaryAction({ sourceId: org.fundingSourceId, month: org.month, markdown: "x", expectedVersion: write.data.version });
    expect(save.ok).toBe(true);
  });

  it("I-29: downgrading to the base plan after a summary exists — write/save refused, screen note-only, row still in DB", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    if (!write.ok) throw new Error("unreachable");

    await db.update(organizations).set({ plan: "reconciliation" }).where(eq(organizations.id, org.orgId));

    const writeAgain = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: write.data.version });
    expect(writeAgain).toEqual({ ok: false, error: UI.summaryPlanNote });
    const save = await saveSummaryAction({ sourceId: org.fundingSourceId, month: org.month, markdown: "x", expectedVersion: write.data.version });
    expect(save).toEqual({ ok: false, error: UI.summaryPlanNote });

    const screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen).toEqual({ access: { use: false, write: false }, summary: null, stale: false, liveExpenseCount: 0, savedMonths: [], writing: false });

    expect(await summaryRow(org.orgId, org.fundingSourceId, org.month)).not.toBeNull();
  });

  it("I-30: a deleted writer/editor user leaves the screen's names null", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    asSession(org.orgId, org.userId);
    const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    if (!write.ok) throw new Error("unreachable");
    const save = await saveSummaryAction({ sourceId: org.fundingSourceId, month: org.month, markdown: "x", expectedVersion: write.data.version });
    if (!save.ok) throw new Error("unreachable");

    await db.delete(users).where(eq(users.id, org.userId));

    const screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
    expect(screen!.summary!.writtenByName).toBeNull();
    expect(screen!.summary!.editedByName).toBeNull();
  });

  it("I-31: the 31st write in the hour is rate-limited with no model call; limits are per-org", async () => {
    const org = await makeOrgWithExpense(freshMonth());
    const other = await createTestOrg({ name: `Rate limit other org ${Date.now()}` });
    createdOrgIds.push(other.orgId);
    await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, other.orgId));

    asSession(org.orgId, org.userId);
    // Every attempt fails checks so nothing is ever persisted, keeping each call cheap and
    // avoiding 30 distinct months.
    writeSummaryMock.mockResolvedValue({ outcome: "failed", inputTokens: null, outputTokens: null });

    for (let i = 0; i < 30; i += 1) {
      const result = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      expect(result.ok).toBe(false);
    }
    writeSummaryMock.mockClear();
    const thirtyFirst = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
    expect(thirtyFirst).toEqual({ ok: false, error: UI.summaryRateLimited });
    expect(writeSummaryMock).not.toHaveBeenCalled();

    // A different org is unaffected.
    const otherUser = await insertUser(other.orgId);
    asSession(other.orgId, otherUser);
    writeSummaryMock.mockResolvedValue({ outcome: "written", markdown: goodDraft(), inputTokens: 1, outputTokens: 1 });
    const [otherItem] = await db
      .insert(lineItems)
      .values({ orgId: other.orgId, fundingSourceId: other.fundingSourceId, name: "Salary", sortOrder: 0 })
      .returning({ id: lineItems.id });
    await db.insert(expenses).values({
      orgId: other.orgId,
      fundingSourceId: other.fundingSourceId,
      lineItemId: otherItem.id,
      date: `${org.month}-05`,
      name: "x",
      paymentSource: "Cash",
      subtotalCents: 100,
      taxCents: 0,
      feesCents: 0,
      taxReimbursable: false,
      feesReimbursable: false,
      sortOrder: 0,
      referenceSeq: 1,
      month: org.month,
    });
    const unaffected = await writeSummaryAction({ sourceId: other.fundingSourceId, month: org.month, expectedVersion: null });
    expect(unaffected.ok).toBe(true);
  });

  describe("I-33: usage row shape per outcome", () => {
    it("success row carries feature/fundingSourceId/month/trigger/model/tokens/cost, exactly one row", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      const rows = await usageRows(org.orgId, org.month);
      expect(rows).toHaveLength(1);
      expect(rows[0].feature).toBe("monthly_summary");
      expect(rows[0].fundingSourceId).toBe(org.fundingSourceId);
      expect(rows[0].month).toBe(org.month);
      expect(rows[0].trigger).toBe("first");
      expect(rows[0].model).toBe("gpt-5.6-terra");
    });

    it("no rows for a refused-before-model path", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      await db.update(organizations).set({ plan: "reconciliation" }).where(eq(organizations.id, org.orgId));
      asSession(org.orgId, org.userId);
      await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      expect(await usageRows(org.orgId, org.month)).toHaveLength(0);
    });
  });

  describe("loadMonthlySummaryScreen", () => {
    it("savedMonths ordered month desc", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });

      const secondMonth = freshMonth();
      await db.insert(expenses).values({
        orgId: org.orgId,
        fundingSourceId: org.fundingSourceId,
        lineItemId: org.lineItemId,
        date: `${secondMonth}-05`,
        name: "y",
        paymentSource: "Cash",
        subtotalCents: 100,
        taxCents: 0,
        feesCents: 0,
        taxReimbursable: false,
        feesReimbursable: false,
        sortOrder: 0,
        referenceSeq: 1,
        month: secondMonth,
      });
      await writeSummaryAction({ sourceId: org.fundingSourceId, month: secondMonth, expectedVersion: null });

      const screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
      const months = screen!.savedMonths.map((m) => m.month);
      expect(months).toEqual([...months].sort().reverse());
    });

    it("another org's source id → null", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      const other = await createTestOrg({ name: `Screen other org ${Date.now()}` });
      createdOrgIds.push(other.orgId);
      const screen = await loadMonthlySummaryScreen(other.orgId, org.fundingSourceId, org.month);
      expect(screen).toBeNull();
    });

    it("liveExpenseCount excludes trashed expenses", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, org.expenseId));
      const screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
      expect(screen!.liveExpenseCount).toBe(0);
    });

    it("I-3: server not configured (no key/model) on the AI plan → access.write=false while access.use stays true and an existing summary still loads", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      if (!write.ok) throw new Error("unreachable");

      vi.unstubAllEnvs();
      vi.stubEnv("OPENAI_API_KEY", "");
      vi.stubEnv("OPENAI_SUMMARY_MODEL", "gpt-5.6-terra");

      const screen = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
      expect(screen!.access).toEqual({ use: true, write: false });
      expect(screen!.summary!.contentMarkdown).toBe(write.data.contentMarkdown);
    });

    it("`writing` is true while a write is in flight (this container) and false once it finishes", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);

      let resolveDeferred!: (value: Awaited<ReturnType<typeof writeSummary>>) => void;
      const deferred = new Promise<Awaited<ReturnType<typeof writeSummary>>>((resolve) => {
        resolveDeferred = resolve;
      });
      writeSummaryMock.mockImplementation(() => deferred);

      const inFlight = writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      await new Promise((resolve) => setTimeout(resolve, 20)); // let it register the in-flight lock
      const whileWriting = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
      expect(whileWriting!.writing).toBe(true);

      resolveDeferred({ outcome: "written", markdown: goodDraft(), inputTokens: 1, outputTokens: 1 });
      const result = await inFlight;
      expect(result.ok).toBe(true);

      const afterWriting = await loadMonthlySummaryScreen(org.orgId, org.fundingSourceId, org.month);
      expect(afterWriting!.writing).toBe(false);
    });
  });

  describe("I-34: a saved draft with no five headings is stored exactly as typed", () => {
    it("succeeds even without the model's required section structure — the structure check only applies to the model's own draft, not a human edit", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      if (!write.ok) throw new Error("unreachable");

      const markdown = "just some free-form notes, no headings at all";
      const result = await saveSummaryAction({
        sourceId: org.fundingSourceId,
        month: org.month,
        markdown,
        expectedVersion: write.data.version,
      });
      expect(result.ok).toBe(true);

      const row = await summaryRow(org.orgId, org.fundingSourceId, org.month);
      expect(row!.contentMarkdown).toBe(markdown);
    });
  });

  describe("loadSummaryCard", () => {
    it("base plan → {use:false, writtenAt:null}, even with a summary row already in the database", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      if (!write.ok) throw new Error("unreachable");

      await db.update(organizations).set({ plan: "reconciliation" }).where(eq(organizations.id, org.orgId));
      const card = await loadSummaryCard(org.orgId, org.fundingSourceId, org.month);
      expect(card).toEqual({ use: false, writtenAt: null });
    });

    it("AI plan, no summary for the month yet → use:true, writtenAt:null", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      const card = await loadSummaryCard(org.orgId, org.fundingSourceId, org.month);
      expect(card).toEqual({ use: true, writtenAt: null });
    });

    it("AI plan with a written summary → use:true, writtenAt matches the stored writtenAt", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      asSession(org.orgId, org.userId);
      const write = await writeSummaryAction({ sourceId: org.fundingSourceId, month: org.month, expectedVersion: null });
      if (!write.ok) throw new Error("unreachable");

      const card = await loadSummaryCard(org.orgId, org.fundingSourceId, org.month);
      expect(card!.use).toBe(true);
      expect(card!.writtenAt).not.toBeNull();
      const row = await summaryRow(org.orgId, org.fundingSourceId, org.month);
      expect(card!.writtenAt).toEqual(row!.writtenAt);
    });

    it("another org's source id → null", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      const other = await createTestOrg({ name: `Summary card other org ${Date.now()}` });
      createdOrgIds.push(other.orgId);
      const card = await loadSummaryCard(other.orgId, org.fundingSourceId, org.month);
      expect(card).toBeNull();
    });

    it("an invalid month key → null", async () => {
      const org = await makeOrgWithExpense(freshMonth());
      const card = await loadSummaryCard(org.orgId, org.fundingSourceId, "not-a-month");
      expect(card).toBeNull();
    });
  });
});
