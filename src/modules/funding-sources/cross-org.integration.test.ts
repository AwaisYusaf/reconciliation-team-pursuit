/**
 * P7.2 — cross-org sweep (docs/PHASE-6.md §5 Phase 7, §4 ★ "A source id from the client
 * belongs to the session's org").
 *
 * Every server action and route handler that accepts a `fundingSourceId` (or the id of a
 * funding-source-scoped row) from the client must refuse another organisation's id and leave
 * that organisation's data unchanged. Org A is fully populated; every call below runs under
 * org B's session, aimed at org A's ids, and is checked twice: the call reports failure, and
 * org A's row is re-read and found untouched.
 *
 * `updateFundingSourceAction` already has this exact proof in
 * `funding-sources/actions.integration.test.ts` ("★ refuses to update a funding source
 * belonging to another organisation") — not duplicated here.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));
vi.mock("@/src/services/auth/session", () => ({ getSession: vi.fn(), requireSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("cross-organisation funding source sweep (P7.2)", async () => {
  const { db } = await import("@/src/db");
  const {
    expenses,
    fundingSources,
    lineItems,
    monthDocuments,
    monthStatuses,
    organizations,
    paymentSources,
    recurringItems,
    users,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  const { getSession, requireSession } = await import("@/src/services/auth/session");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");

  const {
    archiveFundingSourceAction,
    unarchiveFundingSourceAction,
  } = await import("./actions");
  const { setActiveFundingSourceAction } = await import("@/src/modules/auth/actions");
  const { createExpenseAction, updateExpenseAction } = await import("@/src/modules/expenses/actions");
  const { saveLineItemAction, reorderLineItemsAction } = await import("@/src/modules/line-items/actions");
  const { markMonthSubmittedAction, clearMonthSubmittedAction, removeMonthDocumentAction } = await import(
    "@/src/modules/packet/actions"
  );
  const { addRecurringToMonthAction } = await import("@/src/modules/recurring/actions");

  const { GET: packetGet } = await import("@/app/api/downloads/packet/route");
  const { GET: summaryGet } = await import("@/app/api/downloads/summary/route");
  const { GET: coverSheetGet } = await import("@/app/api/downloads/cover-sheet/route");
  const { POST: uploadPost } = await import("@/app/api/files/upload/route");

  const actionSessionMock = vi.mocked(actionSession);
  const getSessionMock = vi.mocked(getSession);
  const requireSessionMock = vi.mocked(requireSession);

  const MONTH = "2097-09";

  let orgA: string;
  let orgB: string;
  let sourceA: string;
  let itemA: string;
  let userA: string;
  let userB: string;
  let monthDocumentA: string;
  let recurringItemA: string;

  async function insertUser(orgId: string) {
    const [row] = await db
      .insert(users)
      .values({
        orgId,
        email: `p72-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    return row.id;
  }

  function sessionContext(orgId: string, userId: string) {
    return {
      orgId,
      userId,
      email: "e@example.com",
      role: "admin" as const,
      orgName: "Org",
      docName: "Doc",
      activeMonth: MONTH,
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
    };
  }

  /** Every action-facing session mock, pointed at org B — the attacker in every test below. */
  function asOrgB() {
    actionSessionMock.mockResolvedValue(sessionContext(orgB, userB));
    requireSessionMock.mockResolvedValue(sessionContext(orgB, userB));
  }

  /** A legitimate action-facing session in org A — for the tests that aren't about crossing an
   *  organisation boundary at all, but about what A's own user may do to A's own archived
   *  source. */
  function asOrgA() {
    actionSessionMock.mockResolvedValue(sessionContext(orgA, userA));
    requireSessionMock.mockResolvedValue(sessionContext(orgA, userA));
  }

  /** Route handlers read `getSession()` directly rather than `actionSession()`. */
  function routeSessionAsOrgB() {
    getSessionMock.mockResolvedValue(sessionContext(orgB, userB));
  }

  /** A legitimate session in org A, for the missing-`source`-param tests below — those are
   *  not an attack scenario, just a malformed request from A's own signed-in user. */
  function routeSessionAsOrgA() {
    getSessionMock.mockResolvedValue(sessionContext(orgA, userA));
  }

  beforeAll(async () => {
    const a = await createTestOrg({ name: "P7.2 Org A", activeMonth: MONTH });
    orgA = a.orgId;
    sourceA = a.fundingSourceId;
    userA = await insertUser(orgA);

    const b = await createTestOrg({ name: "P7.2 Org B", activeMonth: MONTH });
    orgB = b.orgId;
    userB = await insertUser(orgB);

    await db.insert(paymentSources).values({ orgId: orgA, label: "Cash", sortOrder: 0 });

    const [item] = await db
      .insert(lineItems)
      .values({ orgId: orgA, fundingSourceId: sourceA, name: "A's item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    itemA = item.id;

    await db.insert(expenses).values({
      orgId: orgA,
      fundingSourceId: sourceA,
      lineItemId: itemA,
      month: MONTH,
      date: `${MONTH}-05`,
      name: "A's expense",
      paymentSource: "Cash",
      subtotalCents: 1_000,
      taxReimbursable: false,
      feesReimbursable: true,
      sortOrder: 0,
      referenceSeq: await claimReferenceSeq(orgA, sourceA, MONTH),
    });

    const [monthDoc] = await db
      .insert(monthDocuments)
      .values({
        orgId: orgA,
        fundingSourceId: sourceA,
        month: MONTH,
        category: "bank_statement",
        status: "attached",
        s3Key: `test/${orgA}/statement.pdf`,
        filename: "statement.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        sortOrder: 0,
      })
      .returning({ id: monthDocuments.id });
    monthDocumentA = monthDoc.id;

    const [recurring] = await db
      .insert(recurringItems)
      .values({
        orgId: orgA,
        name: "A recurring",
        amountCents: 500,
        lineItemId: itemA,
        sortOrder: 0,
      })
      .returning({ id: recurringItems.id });
    recurringItemA = recurring.id;

    // A's month starts submitted, so clearMonthSubmittedAction has something to (fail to) undo.
    await db
      .insert(monthStatuses)
      .values({ orgId: orgA, fundingSourceId: sourceA, month: MONTH, submittedAt: new Date(), nextReferenceSeq: 2 })
      .onConflictDoUpdate({
        target: [monthStatuses.orgId, monthStatuses.fundingSourceId, monthStatuses.month],
        set: { submittedAt: new Date() },
      });
  });

  afterAll(async () => {
    if (orgA) await db.delete(organizations).where(eq(organizations.id, orgA));
    if (orgB) await db.delete(organizations).where(eq(organizations.id, orgB));
  });

  it("setActiveFundingSourceAction refuses another organisation's source", async () => {
    asOrgB();
    const result = await setActiveFundingSourceAction(sourceA);
    expect(result.ok).toBe(false);

    const [row] = await db
      .select({ activeFundingSourceId: organizations.activeFundingSourceId })
      .from(organizations)
      .where(eq(organizations.id, orgB));
    expect(row.activeFundingSourceId).toBeNull();
  });

  it("archiveFundingSourceAction and unarchiveFundingSourceAction refuse another organisation's source", async () => {
    asOrgB();
    const archived = await archiveFundingSourceAction(sourceA);
    expect(archived.ok).toBe(false);
    const unarchived = await unarchiveFundingSourceAction(sourceA);
    expect(unarchived.ok).toBe(false);

    const [row] = await db
      .select({ archivedAt: fundingSources.archivedAt })
      .from(fundingSources)
      .where(eq(fundingSources.id, sourceA));
    expect(row.archivedAt).toBeNull();
  });

  it("createExpenseAction refuses another organisation's source and line item", async () => {
    asOrgB();
    const before = await db.select().from(expenses).where(eq(expenses.orgId, orgA));

    const result = await createExpenseAction({
      name: "Hijacked expense",
      fundingSourceId: sourceA,
      lineItemId: itemA,
      paymentSource: "Cash",
      taxReimbursable: false,
      feesReimbursable: true,
      month: MONTH,
      date: `${MONTH}-06`,
      description: "",
      subtotal: "1.00",
      tax: "0.00",
      fees: "0.00",
      note: "",
      narrative: "",
      noReceipt: true,
      noReceiptReason: "n/a",
    });
    expect(result.ok).toBe(false);

    const after = await db.select().from(expenses).where(eq(expenses.orgId, orgA));
    expect(after).toHaveLength(before.length);
  });

  it("updateExpenseAction refuses to rebind an expense onto another organisation's source", async () => {
    asOrgB();
    const [existingA] = await db.select().from(expenses).where(eq(expenses.orgId, orgA)).limit(1);

    const result = await updateExpenseAction({
      id: existingA.id,
      name: "Hijacked",
      fundingSourceId: sourceA,
      lineItemId: itemA,
      paymentSource: "Cash",
      taxReimbursable: false,
      feesReimbursable: true,
      month: MONTH,
      date: `${MONTH}-06`,
      description: "",
      subtotal: "1.00",
      tax: "0.00",
      fees: "0.00",
      note: "",
      narrative: "A narrative.",
      noReceipt: true,
      noReceiptReason: "n/a",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Choose a funding source.");

    const [unchanged] = await db.select().from(expenses).where(eq(expenses.id, existingA.id));
    expect(unchanged.name).toBe("A's expense");
  });

  it("markMonthSubmittedAction and clearMonthSubmittedAction refuse another organisation's source", async () => {
    asOrgB();
    const submitted = await markMonthSubmittedAction(MONTH, sourceA);
    expect(submitted.ok).toBe(false);
    const cleared = await clearMonthSubmittedAction(MONTH, sourceA);
    expect(cleared.ok).toBe(false);

    const [status] = await db
      .select({ submittedAt: monthStatuses.submittedAt })
      .from(monthStatuses)
      .where(
        and(
          eq(monthStatuses.orgId, orgA),
          eq(monthStatuses.fundingSourceId, sourceA),
          eq(monthStatuses.month, MONTH),
        ),
      );
    // Still submitted — B's clear attempt did not undo it.
    expect(status.submittedAt).not.toBeNull();
  });

  it("removeMonthDocumentAction refuses another organisation's source", async () => {
    asOrgB();
    const result = await removeMonthDocumentAction(monthDocumentA, sourceA);
    expect(result.ok).toBe(false);

    const [row] = await db
      .select({ status: monthDocuments.status })
      .from(monthDocuments)
      .where(eq(monthDocuments.id, monthDocumentA));
    expect(row.status).toBe("attached");
  });

  it("removeMonthDocumentAction refuses an archived source, keeping its history intact", async () => {
    // Archiving is meant to preserve a source's documents, not just hide the source. Uploading
    // into an archived source is already refused; deleting out of one is the same record from
    // the other end.
    asOrgA();
    await db
      .update(fundingSources)
      .set({ archivedAt: new Date() })
      .where(eq(fundingSources.id, sourceA));

    try {
      const result = await removeMonthDocumentAction(monthDocumentA, sourceA);
      expect(result.ok).toBe(false);

      const [row] = await db
        .select({ status: monthDocuments.status })
        .from(monthDocuments)
        .where(eq(monthDocuments.id, monthDocumentA));
      expect(row.status).toBe("attached");
    } finally {
      await db
        .update(fundingSources)
        .set({ archivedAt: null })
        .where(eq(fundingSources.id, sourceA));
    }
  });

  it("saveLineItemAction refuses to create or edit against another organisation's source", async () => {
    asOrgB();
    const created = await saveLineItemAction({
      fundingSourceId: sourceA,
      name: "Hijacked line item",
      scheduledValue: "1.00",
      openingBilled: "0.00",
    });
    expect(created.ok).toBe(false);

    const edited = await saveLineItemAction({
      id: itemA,
      fundingSourceId: sourceA,
      name: "Renamed",
      scheduledValue: "1.00",
      openingBilled: "0.00",
    });
    expect(edited.ok).toBe(false);

    const rows = await db.select().from(lineItems).where(eq(lineItems.fundingSourceId, sourceA));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("A's item");
  });

  it("reorderLineItemsAction refuses another organisation's source", async () => {
    asOrgB();
    const result = await reorderLineItemsAction([itemA], sourceA);
    expect(result.ok).toBe(false);

    const [row] = await db.select({ sortOrder: lineItems.sortOrder }).from(lineItems).where(eq(lineItems.id, itemA));
    expect(row.sortOrder).toBe(0);
  });

  it("addRecurringToMonthAction refuses another organisation's recurring item", async () => {
    asOrgB();
    const before = await db.select().from(expenses).where(eq(expenses.orgId, orgA));

    const result = await addRecurringToMonthAction(recurringItemA, MONTH);
    expect(result.ok).toBe(false);

    const after = await db.select().from(expenses).where(eq(expenses.orgId, orgA));
    expect(after).toHaveLength(before.length);
  });

  function downloadRequest(path: string, params: Record<string, string>): Request {
    const url = new URL(`http://localhost${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return new Request(url, { headers: { "Sec-Fetch-Site": "same-origin" } });
  }

  it("the packet download route refuses another organisation's source", async () => {
    routeSessionAsOrgB();
    const response = await packetGet(downloadRequest("/api/downloads/packet", { month: MONTH, source: sourceA }));
    expect(response.status).toBe(404);
  });

  it("the summary download route refuses another organisation's source", async () => {
    routeSessionAsOrgB();
    const response = await summaryGet(downloadRequest("/api/downloads/summary", { month: MONTH, source: sourceA }));
    expect(response.status).toBe(404);
  });

  it("the cover sheet download route refuses another organisation's source", async () => {
    routeSessionAsOrgB();
    const response = await coverSheetGet(
      downloadRequest("/api/downloads/cover-sheet", { month: MONTH, lineItem: itemA, source: sourceA }),
    );
    expect(response.status).toBe(404);
  });

  // Review-requested coverage: a `source` query parameter is required on every download
  // route (Phase 6 step 1) — this was already true in code (the route treats a missing param
  // the same as an unowned one: `findFundingSource` gets `""`, finds nothing, 404s) but had
  // no test proving it, under a legitimate same-org session rather than a cross-org attacker.
  it("the packet download route 404s when the source param is missing entirely", async () => {
    routeSessionAsOrgA();
    const response = await packetGet(downloadRequest("/api/downloads/packet", { month: MONTH }));
    expect(response.status).toBe(404);
  });

  it("the summary download route 404s when the source param is missing entirely", async () => {
    routeSessionAsOrgA();
    const response = await summaryGet(downloadRequest("/api/downloads/summary", { month: MONTH }));
    expect(response.status).toBe(404);
  });

  it("the cover sheet download route 404s when the source param is missing entirely", async () => {
    routeSessionAsOrgA();
    const response = await coverSheetGet(
      downloadRequest("/api/downloads/cover-sheet", { month: MONTH, lineItem: itemA }),
    );
    expect(response.status).toBe(404);
  });

  it("the upload route refuses another organisation's source for a month document", async () => {
    routeSessionAsOrgB();
    const form = new FormData();
    form.set("target", "month");
    form.set("category", "bank_statement");
    form.set("month", MONTH);
    form.set("fundingSourceId", sourceA);
    form.set("file", new File([new Uint8Array([1, 2, 3])], "statement.pdf", { type: "application/pdf" }));

    const request = new NextRequest("http://localhost/api/files/upload", {
      method: "POST",
      body: form,
      headers: { "sec-fetch-site": "same-origin" },
    });
    const response = await uploadPost(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);

    const [row] = await db
      .select({ status: monthDocuments.status })
      .from(monthDocuments)
      .where(eq(monthDocuments.id, monthDocumentA));
    expect(row.status).toBe("attached");
  });
});
