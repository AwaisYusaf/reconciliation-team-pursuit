/**
 * `loadExpenseAmounts` and soft delete.
 *
 * A trashed expense must drop out of every budget total the instant it is trashed, and
 * come back with the exact same amounts once restored — this is the money-correctness
 * surface the whole feature exists to protect. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("loadExpenseAmounts and trash (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, lineItems, organizations } = await import("@/src/db/schema");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { loadExpenseAmounts } = await import("./queries");

  let orgId: string;
  let lineItemId: string;

  const MONTH = "2099-05";

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Amounts Trash Org", docName: "AmtTrash", activeMonth: MONTH })
      .returning({ id: organizations.id });
    orgId = org.id;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, name: "Supplies", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("excludes a trashed expense from the budget totals, then includes it again once restored, at the same amount", async () => {
    const [kept] = await db
      .insert(expenses)
      .values({
        orgId,
        lineItemId,
        month: MONTH,
        date: `${MONTH}-05`,
        name: "Kept",
        paymentSource: "x",
        subtotalCents: 5_000,
        taxCents: 500,
        feesCents: 100,
        taxReimbursable: true,
        feesReimbursable: true,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, MONTH),
      })
      .returning({ id: expenses.id });

    const [toTrash] = await db
      .insert(expenses)
      .values({
        orgId,
        lineItemId,
        month: MONTH,
        date: `${MONTH}-06`,
        name: "Will be trashed",
        paymentSource: "x",
        subtotalCents: 7_000,
        taxCents: 700,
        feesCents: 300,
        taxReimbursable: true,
        feesReimbursable: false,
        sortOrder: 1,
        referenceSeq: await claimReferenceSeq(orgId, MONTH),
      })
      .returning({ id: expenses.id });

    const before = await loadExpenseAmounts(orgId, MONTH);
    expect(before).toHaveLength(2);
    const beforeTotal = before.reduce((sum, row) => sum + row.subtotalCents, 0);
    expect(beforeTotal).toBe(12_000);

    await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, toTrash.id));

    const trashed = await loadExpenseAmounts(orgId, MONTH);
    expect(trashed).toHaveLength(1);
    expect(trashed[0].subtotalCents).toBe(5_000);
    expect(trashed.reduce((sum, row) => sum + row.subtotalCents, 0)).toBe(5_000);

    await db.update(expenses).set({ deletedAt: null }).where(eq(expenses.id, toTrash.id));

    const restored = await loadExpenseAmounts(orgId, MONTH);
    expect(restored).toHaveLength(2);
    expect(restored.reduce((sum, row) => sum + row.subtotalCents, 0)).toBe(beforeTotal);
    const restoredRow = restored.find((row) => row.lineItemId === lineItemId && row.subtotalCents === 7_000);
    expect(restoredRow).toMatchObject({ taxCents: 700, feesCents: 300, taxReimbursable: true, feesReimbursable: false });

    expect(kept.id).toBeTruthy();
  });
});
