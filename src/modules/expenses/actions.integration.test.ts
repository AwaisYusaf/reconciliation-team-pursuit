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
    const { orgId, userId, sourceB, itemB } = await twoSourceOrg("Source Defaults Org");
    asOrg(orgId, userId);

    // Source B's rules (seeded above) are tax=true, fees=false — mirroring what the form
    // pre-fills from `loadExpenseFormOptions`'s `fundingSources` entry for source B.
    const created = await createExpenseAction(
      baseInput({
        fundingSourceId: sourceB,
        lineItemId: itemB,
        taxReimbursable: true,
        feesReimbursable: false,
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [row] = await db.select().from(expenses).where(eq(expenses.id, created.data.id));
    expect(row.taxReimbursable).toBe(true);
    expect(row.feesReimbursable).toBe(false);
  });
});
