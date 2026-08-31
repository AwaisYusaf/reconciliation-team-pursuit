/**
 * Line item usage counts against a real database (m08).
 *
 * The delete decision itself is unit-tested in `domain/line-item-rules.test.ts`; what
 * needs a database is that the counts feeding it are right, and that the recurring-item
 * cascade actually fires. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("line item usage counts (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, lineItems, organizations, recurringItems } = await import("@/src/db/schema");
  const { planLineItemDelete } = await import("@/src/domain/line-item-rules");
  const { loadLineItemRows } = await import("./queries");

  let orgId: string;
  let usedId: string;
  let recurringOnlyId: string;
  let unusedId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "m08 Org", docName: "m08", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    orgId = org.id;

    const inserted = await db
      .insert(lineItems)
      .values([
        { orgId, name: "Salary", scheduledValueCents: 100000, sortOrder: 0 },
        { orgId, name: "Office Space", scheduledValueCents: 50000, sortOrder: 1 },
        { orgId, name: "Unused", scheduledValueCents: 1000, sortOrder: 2 },
      ])
      .returning({ id: lineItems.id, name: lineItems.name });

    usedId = inserted.find((row) => row.name === "Salary")!.id;
    recurringOnlyId = inserted.find((row) => row.name === "Office Space")!.id;
    unusedId = inserted.find((row) => row.name === "Unused")!.id;

    await db.insert(expenses).values([
      { orgId, lineItemId: usedId, month: "2026-01", date: "2026-01-10", name: "Payroll 1", paymentSource: "x", subtotalCents: 1000, referenceSeq: 1, taxReimbursable: false, feesReimbursable: true },
      { orgId, lineItemId: usedId, month: "2026-02", date: "2026-02-10", name: "Payroll 2", paymentSource: "x", subtotalCents: 2000, referenceSeq: 1, taxReimbursable: false, feesReimbursable: true },
    ]);

    await db.insert(recurringItems).values([
      { orgId, name: "Monthly rent", amountCents: 250000, lineItemId: recurringOnlyId },
      { orgId, name: "Parking", amountCents: 10000, lineItemId: recurringOnlyId },
    ]);
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("counts expenses across every month, not only the active one", async () => {
    const rows = await loadLineItemRows(orgId);
    const salary = rows.find((row) => row.name === "Salary")!;
    expect(salary.expenseCount).toBe(2);
  });

  it("lists the recurring items a delete would cascade", async () => {
    const rows = await loadLineItemRows(orgId);
    const office = rows.find((row) => row.name === "Office Space")!;
    expect(office.expenseCount).toBe(0);
    expect(office.recurringNames).toEqual(["Monthly rent", "Parking"]);
  });

  it("reports zero usage for an untouched line item", async () => {
    const rows = await loadLineItemRows(orgId);
    const unused = rows.find((row) => row.name === "Unused")!;
    expect(unused).toMatchObject({ expenseCount: 0, recurringNames: [] });
  });

  it("feeds the delete rule the right verdict for each case", async () => {
    const rows = await loadLineItemRows(orgId);
    const verdicts = Object.fromEntries(
      rows.map((row) => [row.name, planLineItemDelete(row)]),
    );

    expect(verdicts.Salary.allowed).toBe(false);
    expect(verdicts["Office Space"]).toEqual({
      allowed: true,
      cascadingRecurring: ["Monthly rent", "Parking"],
    });
    expect(verdicts.Unused).toEqual({ allowed: true, cascadingRecurring: [] });
  });

  it("refuses at the database too, if the count check were ever bypassed (R9.3)", async () => {
    // Drizzle wraps driver errors, so the constraint name lives on the cause.
    const rejection = await db
      .delete(lineItems)
      .where(eq(lineItems.id, usedId))
      .then(() => null)
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    const cause = (rejection as Error & { cause?: { constraint?: string; code?: string } }).cause;
    expect(cause?.code).toBe("23503"); // foreign_key_violation
    expect(cause?.constraint).toBe("expenses_line_item_id_line_items_id_fk");
  });

  it("cascade-deletes recurring items with their line item", async () => {
    await db.delete(lineItems).where(eq(lineItems.id, recurringOnlyId));

    const remaining = await db
      .select()
      .from(recurringItems)
      .where(eq(recurringItems.orgId, orgId));
    expect(remaining).toHaveLength(0);
  });

  it("returns rows in configured order", async () => {
    const rows = await loadLineItemRows(orgId);
    expect(rows.map((row) => row.name)).toEqual(["Salary", "Unused"]);
    expect(unusedId).toBeTruthy();
  });
});
