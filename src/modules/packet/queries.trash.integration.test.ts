/**
 * `loadPacketReadiness` and soft delete.
 *
 * The documentation gate is the sharpest edge here: an expense missing its evidence blocks
 * every download for the month (R4.3). Trashing it must lift that block, and restoring it
 * must reinstate the block — not just move it out of the totals. Skipped when DATABASE_URL
 * is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("loadPacketReadiness and trash (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, lineItems, organizations } = await import("@/src/db/schema");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { loadPacketReadiness } = await import("./queries");

  let orgId: string;
  let lineItemId: string;

  const MONTH = "2099-09";

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Packet Trash Org", docName: "PktTrash", activeMonth: MONTH })
      .returning({ id: organizations.id });
    orgId = org.id;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, name: "Consulting", scheduledValueCents: 300_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("drops the amount, the record count and the blocking entry once trashed, and restores all three", async () => {
    // Deliberately no documents attached — this expense is documentation-incomplete and must
    // block the month (R4.3) for as long as it is active.
    const [expense] = await db
      .insert(expenses)
      .values({
        orgId,
        lineItemId,
        month: MONTH,
        date: `${MONTH}-08`,
        name: "Undocumented consulting fee",
        paymentSource: "x",
        subtotalCents: 6_000,
        taxCents: 0,
        feesCents: 0,
        taxReimbursable: false,
        feesReimbursable: false,
        noReceipt: false,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, MONTH),
      })
      .returning({ id: expenses.id });

    const before = await loadPacketReadiness(orgId, MONTH);
    expect(before.totalAmountCents).toBe(6_000);
    expect(before.totalRecords).toBe(1);
    expect(before.blocking.map((row) => row.expenseId)).toContain(expense.id);
    expect(before.blocking[0]?.label).toContain("missing both");
    const beforeRow = before.rows.find((row) => row.lineItemId === lineItemId)!;
    expect(beforeRow.recordCount).toBe(1);
    expect(beforeRow.complete).toBe(false);
    const beforePages = before.totalPages;

    await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, expense.id));

    const trashed = await loadPacketReadiness(orgId, MONTH);
    expect(trashed.totalAmountCents).toBe(0);
    expect(trashed.totalRecords).toBe(0);
    expect(trashed.blocking).toHaveLength(0);
    const trashedRow = trashed.rows.find((row) => row.lineItemId === lineItemId)!;
    expect(trashedRow.recordCount).toBe(0);
    // No records means "—", not "Yes" — an empty line item is not vacuously complete.
    expect(trashedRow.complete).toBeNull();
    expect(trashed.totalPages).toBeLessThan(beforePages);

    await db.update(expenses).set({ deletedAt: null }).where(eq(expenses.id, expense.id));

    const restored = await loadPacketReadiness(orgId, MONTH);
    expect(restored.totalAmountCents).toBe(6_000);
    expect(restored.totalRecords).toBe(1);
    expect(restored.blocking.map((row) => row.expenseId)).toContain(expense.id);
    expect(restored.totalPages).toBe(beforePages);
  });
});
