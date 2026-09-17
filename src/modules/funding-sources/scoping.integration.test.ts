/**
 * ★ Per-source isolation (Phase 6, D-93, Phase 2 §5 step 7): a packet, a list, a budget
 * total must never contain another source's rows.
 *
 * One organisation gets two funding sources, each with its own line item and expense in the
 * same month. Every loader Phase 2 scoped by `fundingSourceId` is called once per source and
 * asserted to return only that source's data — the same shape of proof
 * `funding-sources-migration.integration.test.ts` uses at the database layer, done here at the
 * query layer instead.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("funding source isolation across loaders (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, fundingSources, lineItems, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { loadExpenseAmounts, loadFundingSourceSettings, loadLineItemBudgets } = await import(
    "@/src/db/queries"
  );
  const { loadSelectableMonths } = await import("@/src/db/months");
  const { loadMonthSnapshot } = await import("@/src/generation/month-snapshot");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { loadExpenseFormOptions, loadMonthExpenses, loadTrashedExpenses } = await import(
    "@/src/modules/expenses/queries"
  );
  const { findLineItem, loadLineItemRows } = await import("@/src/modules/line-items/queries");
  const { loadPacketReadiness } = await import("@/src/modules/packet/queries");

  const MONTH = "2098-01";
  let orgId: string;
  let sourceA: string;
  let sourceB: string;
  let itemA: string;
  let itemB: string;

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Isolation Org", activeMonth: MONTH });
    orgId = org.orgId;
    sourceA = org.fundingSourceId;

    const [b] = await db
      .insert(fundingSources)
      .values({
        orgId,
        name: "Source B",
        type: "donation",
        sortOrder: 1,
        taxReimbursable: true,
        feesReimbursable: false,
        contractValueCents: 5_000_00,
        advancesReceivedCents: 100_00,
      })
      .returning({ id: fundingSources.id });
    sourceB = b.id;

    const [ia] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceA, name: "A's item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    itemA = ia.id;

    const [ib] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceB, name: "B's item", scheduledValueCents: 200_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    itemB = ib.id;

    await db.insert(expenses).values({
      orgId,
      fundingSourceId: sourceA,
      lineItemId: itemA,
      month: MONTH,
      date: `${MONTH}-05`,
      name: "A's expense",
      paymentSource: "x",
      subtotalCents: 1_000,
      taxReimbursable: false,
      feesReimbursable: true,
      sortOrder: 0,
      referenceSeq: await claimReferenceSeq(orgId, sourceA, MONTH),
    });

    await db.insert(expenses).values({
      orgId,
      fundingSourceId: sourceB,
      lineItemId: itemB,
      month: MONTH,
      date: `${MONTH}-06`,
      name: "B's expense",
      paymentSource: "x",
      subtotalCents: 2_000,
      taxReimbursable: false,
      feesReimbursable: true,
      sortOrder: 0,
      referenceSeq: await claimReferenceSeq(orgId, sourceB, MONTH),
    });
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("loadLineItemBudgets returns only the given source's line items", async () => {
    const rows = await loadLineItemBudgets(orgId, sourceA);
    expect(rows.map((r) => r.id)).toEqual([itemA]);
    expect(rows.map((r) => r.id)).not.toContain(itemB);
  });

  it("loadExpenseAmounts returns only the given source's expenses", async () => {
    const rows = await loadExpenseAmounts(orgId, sourceA, MONTH);
    expect(rows.every((r) => r.lineItemId === itemA)).toBe(true);
  });

  it("loadFundingSourceSettings never returns the other source's settings", async () => {
    const a = await loadFundingSourceSettings(orgId, sourceA);
    const b = await loadFundingSourceSettings(orgId, sourceB);
    expect(a.advancesReceivedCents).not.toBe(b.advancesReceivedCents);
    expect(b.advancesReceivedCents).toBe(100_00);
  });

  it("loadSelectableMonths scoped to one source excludes a month only the other source used", async () => {
    const onlyB = "2098-02";
    await db.insert(expenses).values({
      orgId,
      fundingSourceId: sourceB,
      lineItemId: itemB,
      month: onlyB,
      date: `${onlyB}-01`,
      name: "B's only month",
      paymentSource: "x",
      subtotalCents: 500,
      taxReimbursable: false,
      feesReimbursable: true,
      sortOrder: 1,
      referenceSeq: await claimReferenceSeq(orgId, sourceB, onlyB),
    });

    const monthsForA = await loadSelectableMonths(orgId, sourceA);
    expect(monthsForA).not.toContain(onlyB);
    const monthsForB = await loadSelectableMonths(orgId, sourceB);
    expect(monthsForB).toContain(onlyB);
  });

  it("loadLineItemRows and findLineItem never cross sources", async () => {
    const rowsA = await loadLineItemRows(orgId, sourceA);
    expect(rowsA.map((r) => r.id)).toEqual([itemA]);

    expect(await findLineItem(orgId, sourceA, itemB)).toBeNull();
    expect((await findLineItem(orgId, sourceA, itemA))?.id).toBe(itemA);
  });

  // Phase 4: `loadExpenseFormOptions` no longer returns a flat `lineItems` list — it groups by
  // source instead. Rewritten to keep the same intent (no cross-source leakage) against the
  // new shape rather than the removed one.
  it("loadExpenseFormOptions groups line items by source with no cross-source leakage", async () => {
    const options = await loadExpenseFormOptions(orgId, null);
    expect(options.lineItemsBySource[sourceA]?.map((i) => i.id)).toEqual([itemA]);
    expect(options.lineItemsBySource[sourceB]?.map((i) => i.id)).toEqual([itemB]);
  });

  it("loadMonthExpenses and loadTrashedExpenses never cross sources", async () => {
    const monthExpenses = await loadMonthExpenses(orgId, sourceA, MONTH);
    expect(monthExpenses.every((e) => e.fundingSourceId === sourceA)).toBe(true);
    expect(monthExpenses.some((e) => e.name === "B's expense")).toBe(false);

    // Scoped to this suite's own org: two other integration files create an expense with the
    // same name, and a bare name match would soft-delete one of theirs mid-run — which failed
    // this test and theirs at random, depending on which files vitest happened to interleave.
    const [bExpense] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.name, "B's expense")));
    await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, bExpense.id));

    const trashedForA = await loadTrashedExpenses(orgId, sourceA);
    expect(trashedForA.map((e) => e.id)).not.toContain(bExpense.id);
    const trashedForB = await loadTrashedExpenses(orgId, sourceB);
    expect(trashedForB.map((e) => e.id)).toContain(bExpense.id);

    await db.update(expenses).set({ deletedAt: null }).where(eq(expenses.id, bExpense.id));
  });

  it("loadPacketReadiness for source A contains none of source B's line items or expenses", async () => {
    const readiness = await loadPacketReadiness(orgId, sourceA, MONTH);
    expect(readiness.rows.map((r) => r.lineItemId)).not.toContain(itemB);
    expect(readiness.blocking.every((r) => r.expenseId !== undefined)).toBe(true);
  });

  it("loadMonthSnapshot for one source never includes the other source's line items or expenses", async () => {
    const snapshotA = await loadMonthSnapshot(orgId, sourceA, MONTH);
    expect(snapshotA.lineItems.map((i) => i.id)).toEqual([itemA]);
    expect(snapshotA.expenses.map((e) => e.name)).not.toContain("B's expense");

    const snapshotB = await loadMonthSnapshot(orgId, sourceB, MONTH);
    expect(snapshotB.lineItems.map((i) => i.id)).toEqual([itemB]);
    expect(snapshotB.expenses.map((e) => e.name)).not.toContain("A's expense");
  });
});
