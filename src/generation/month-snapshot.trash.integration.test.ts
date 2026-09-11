/**
 * `loadMonthSnapshot` and soft delete.
 *
 * Both halves of the snapshot have to agree with the trash: the current month's `expenses`
 * array (what prints on this month's packet) and `amounts` (the previously-billed math that
 * drives the budget columns for every month before this one). Skipped when DATABASE_URL is
 * absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("loadMonthSnapshot and trash (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, lineItems, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { loadMonthSnapshot } = await import("./month-snapshot");

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;

  const PRIOR_MONTH = "2099-07";
  const CURRENT_MONTH = "2099-08";

  beforeAll(async () => {
    const org = await createTestOrg({
      name: "Snapshot Trash Org",
      docName: "SnapTrash",
      activeMonth: CURRENT_MONTH,
    });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Equipment", scheduledValueCents: 200_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("excludes a trashed current-month expense, and its prior-month amounts, then restores both", async () => {
    const [priorExpense] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId,
        month: PRIOR_MONTH,
        date: `${PRIOR_MONTH}-12`,
        name: "Prior month purchase",
        paymentSource: "x",
        subtotalCents: 9_000,
        taxReimbursable: false,
        feesReimbursable: true,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, fundingSourceId, PRIOR_MONTH),
      })
      .returning({ id: expenses.id });

    const [currentExpense] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId,
        month: CURRENT_MONTH,
        date: `${CURRENT_MONTH}-03`,
        name: "This month purchase",
        paymentSource: "x",
        subtotalCents: 4_000,
        taxReimbursable: false,
        feesReimbursable: true,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, fundingSourceId, CURRENT_MONTH),
      })
      .returning({ id: expenses.id });

    const before = await loadMonthSnapshot(orgId, fundingSourceId, CURRENT_MONTH);
    expect(before.expenses.map((row) => row.id)).toContain(currentExpense.id);
    expect(before.amounts.filter((row) => row.month === PRIOR_MONTH)).toHaveLength(1);
    expect(before.amounts.find((row) => row.month === PRIOR_MONTH)?.subtotalCents).toBe(9_000);

    await db
      .update(expenses)
      .set({ deletedAt: new Date() })
      .where(eq(expenses.id, priorExpense.id));
    await db
      .update(expenses)
      .set({ deletedAt: new Date() })
      .where(eq(expenses.id, currentExpense.id));

    const trashed = await loadMonthSnapshot(orgId, fundingSourceId, CURRENT_MONTH);
    expect(trashed.expenses.map((row) => row.id)).not.toContain(currentExpense.id);
    expect(trashed.amounts.filter((row) => row.month === PRIOR_MONTH)).toHaveLength(0);

    await db.update(expenses).set({ deletedAt: null }).where(eq(expenses.id, priorExpense.id));
    await db.update(expenses).set({ deletedAt: null }).where(eq(expenses.id, currentExpense.id));

    const restored = await loadMonthSnapshot(orgId, fundingSourceId, CURRENT_MONTH);
    expect(restored.expenses.map((row) => row.id)).toContain(currentExpense.id);
    expect(restored.amounts.filter((row) => row.month === PRIOR_MONTH)).toHaveLength(1);
    expect(restored.amounts.find((row) => row.month === PRIOR_MONTH)?.subtotalCents).toBe(9_000);
  });
});
