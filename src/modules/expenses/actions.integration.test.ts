/**
 * `createExpenseAction` / `updateExpenseAction` against a real database (Phase 6, D-93,
 * Phase 4) — the invariants named in docs/PHASE-6.md §5 Phase 4 step 7 and §4's ★ row
 * "Saving against another source's line item is impossible."
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("expense create/update and funding sources (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, fundingSources, lineItems, organizations, paymentSources, users } = await import(
    "@/src/db/schema"
  );
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  const { createExpenseAction, updateExpenseAction } = await import("./actions");
  const { loadExpenseFormOptions } = await import("./queries");

  const session = vi.mocked(actionSession);

  const createdOrgIds: string[] = [];
  afterAll(async () => {
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  /** A real users row — `expense_audit_events.actor_user_id` carries a NOT NULL FK to it. */
  async function insertUser(orgId: string) {
    const [row] = await db
      .insert(users)
      .values({
        orgId,
        email: `u-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    return row.id;
  }

  function asOrg(orgId: string, userId: string) {
    session.mockResolvedValue({
      orgId,
      userId,
      email: "e@example.com",
      role: "admin",
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2098-01",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
    });
  }

  const MONTH = "2098-01";

  function baseInput(overrides: Partial<Parameters<typeof createExpenseAction>[0]>) {
    return {
      name: "Test expense",
      fundingSourceId: "",
      lineItemId: "",
      paymentSource: "Cash",
      taxReimbursable: false,
      feesReimbursable: true,
      month: MONTH,
      date: `${MONTH}-05`,
      description: "",
      subtotal: "10.00",
      tax: "0.00",
      fees: "0.00",
      note: "",
      narrative: "A narrative.",
      noReceipt: false,
      noReceiptReason: "",
      ...overrides,
    };
  }

  /** Two funding sources in one org, each with its own line item, plus payment source "Cash". */
  async function twoSourceOrg(name: string) {
    const created = await createTestOrg({ name, activeMonth: MONTH });
    createdOrgIds.push(created.orgId);
    const orgId = created.orgId;
    const sourceA = created.fundingSourceId;

    const [b] = await db
      .insert(fundingSources)
      .values({
        orgId,
        name: "Source B",
        type: "grant",
        sortOrder: 1,
        taxReimbursable: true,
        feesReimbursable: false,
      })
      .returning({ id: fundingSources.id });
    const sourceB = b.id;

    const [itemA] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceA, name: "A item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    const [itemB] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceB, name: "B item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });

    await db.insert(paymentSources).values({ orgId, label: "Cash", sortOrder: 0 });
    const userId = await insertUser(orgId);

    return { orgId, userId, sourceA, sourceB, itemA: itemA.id, itemB: itemB.id };
  }

  it("★ refuses to create an expense against another source's line item", async () => {
    const { orgId, userId, sourceA, itemB } = await twoSourceOrg("Cross Source Create Org");
    asOrg(orgId, userId);

    const result = await createExpenseAction(
      baseInput({ fundingSourceId: sourceA, lineItemId: itemB }),
    );
    expect(result.ok).toBe(false);

    const rows = await db.select().from(expenses).where(eq(expenses.orgId, orgId));
    expect(rows).toHaveLength(0);
  });

  it("moving an expense to another source claims a new reference there and leaves the old counter untouched", async () => {
    const { orgId, userId, sourceA, sourceB, itemA, itemB } = await twoSourceOrg("Move Source Org");
    asOrg(orgId, userId);

    const created = await createExpenseAction(
      baseInput({ fundingSourceId: sourceA, lineItemId: itemA }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [before] = await db.select().from(expenses).where(eq(expenses.id, created.data.id));
    expect(before.fundingSourceId).toBe(sourceA);
    const originalRef = before.referenceSeq;

    const updated = await updateExpenseAction(
      baseInput({
        id: created.data.id,
        fundingSourceId: sourceB,
        lineItemId: itemB,
      }),
    );
    expect(updated.ok).toBe(true);

    const [after] = await db.select().from(expenses).where(eq(expenses.id, created.data.id));
    expect(after.fundingSourceId).toBe(sourceB);
    expect(after.lineItemId).toBe(itemB);
    // Moved into an empty (source B, month) pair, so it claims reference 1 there regardless
    // of what number it held under source A.
    expect(after.referenceSeq).toBe(1);

    // A reference already claimed and printed is never reissued (R2.6), so a fresh expense
    // under source A continues from `originalRef + 1` — not `originalRef` again. What this
    // proves is the more important half: the move away from source A did not burn a *second*
    // number there (which would have skipped to +2) — the counter only ever advanced once,
    // for the original create.
    const second = await createExpenseAction(
      baseInput({ fundingSourceId: sourceA, lineItemId: itemA }),
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      const [row] = await db.select().from(expenses).where(eq(expenses.id, second.data.id));
      expect(row.referenceSeq).toBe(originalRef + 1);
    }
  });

  it("refuses to move an expense into an archived funding source", async () => {
    const { orgId, userId, sourceA, sourceB, itemA, itemB } = await twoSourceOrg("Move Into Archived Org");
    asOrg(orgId, userId);

    await db.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, sourceB));

    const created = await createExpenseAction(
      baseInput({ fundingSourceId: sourceA, lineItemId: itemA }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateExpenseAction(
      baseInput({ id: created.data.id, fundingSourceId: sourceB, lineItemId: itemB }),
    );
    expect(result.ok).toBe(false);

    const [row] = await db.select().from(expenses).where(eq(expenses.id, created.data.id));
    expect(row.fundingSourceId).toBe(sourceA);
  });

  it("editing an expense already sitting on an archived source (source unchanged) is still allowed", async () => {
    const { orgId, userId, sourceA, itemA } = await twoSourceOrg("Edit On Archived Org");
    asOrg(orgId, userId);

    const created = await createExpenseAction(
      baseInput({ fundingSourceId: sourceA, lineItemId: itemA }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await db.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, sourceA));

    const result = await updateExpenseAction(
      baseInput({
        id: created.data.id,
        fundingSourceId: sourceA,
        lineItemId: itemA,
        name: "Corrected name",
      }),
    );
    expect(result.ok).toBe(true);

    const [row] = await db.select().from(expenses).where(eq(expenses.id, created.data.id));
    expect(row.name).toBe("Corrected name");
  });

  it("a new expense's default reimbursement rules match its funding source's rules", async () => {
    // Review fix: the previous version of this test hardcoded taxReimbursable/feesReimbursable
    // in the input and then asserted the saved row matched — that would still pass even if the
    // source's rules were ignored entirely, since createExpenseAction never derives the flags
    // itself (the form pre-fills them; the server just persists whatever it is given). This
    // version instead reads source B's rules from `loadExpenseFormOptions` — the same query the
    // form calls to pre-fill the checkboxes — and only then uses *those* values, so a bug that
    // broke the source-to-form link (e.g. always returning ORIGINAL_RULES, or another source's
    // rules) would make this test fail rather than silently agree with itself.
    const { orgId, userId, sourceB, itemB } = await twoSourceOrg("Source Defaults Org");
    asOrg(orgId, userId);

    // Ground truth: what source B was actually seeded with (tax=true, fees=false).
    const [seeded] = await db
      .select({ taxReimbursable: fundingSources.taxReimbursable, feesReimbursable: fundingSources.feesReimbursable })
      .from(fundingSources)
      .where(eq(fundingSources.id, sourceB));
    expect(seeded.taxReimbursable).toBe(true);
    expect(seeded.feesReimbursable).toBe(false);

    // The form's own data source for the pre-fill must report the same rules for source B.
    const options = await loadExpenseFormOptions(orgId, null);
    const sourceBOption = options.fundingSources.find((source) => source.id === sourceB);
    expect(sourceBOption?.taxReimbursable).toBe(seeded.taxReimbursable);
    expect(sourceBOption?.feesReimbursable).toBe(seeded.feesReimbursable);

    // A save carrying exactly what the form would have pre-filled persists unchanged.
    const created = await createExpenseAction(
      baseInput({
        fundingSourceId: sourceB,
        lineItemId: itemB,
        taxReimbursable: sourceBOption!.taxReimbursable,
        feesReimbursable: sourceBOption!.feesReimbursable,
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [row] = await db.select().from(expenses).where(eq(expenses.id, created.data.id));
    expect(row.taxReimbursable).toBe(seeded.taxReimbursable);
    expect(row.feesReimbursable).toBe(seeded.feesReimbursable);
  });

  it("creating a line item against an archived funding source is refused", async () => {
    const { orgId, userId, sourceA } = await twoSourceOrg("Archived Line Item Create Org");
    await db.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, sourceA));
    asOrg(orgId, userId);

    const { saveLineItemAction } = await import("@/src/modules/line-items/actions");
    const result = await saveLineItemAction({
      fundingSourceId: sourceA,
      name: "New line item on archived source",
      scheduledValue: "100.00",
      openingBilled: "0.00",
    });
    expect(result.ok).toBe(false);
  });

  it("creating an expense against an archived funding source is refused", async () => {
    const { orgId, userId, sourceA, itemA } = await twoSourceOrg("Archived Expense Create Org");
    await db.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, sourceA));
    asOrg(orgId, userId);

    const result = await createExpenseAction(baseInput({ fundingSourceId: sourceA, lineItemId: itemA }));
    expect(result.ok).toBe(false);

    const rows = await db.select().from(expenses).where(eq(expenses.fundingSourceId, sourceA));
    expect(rows).toHaveLength(0);
  });
});
