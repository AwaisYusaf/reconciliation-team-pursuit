/**
 * Query-layer behaviour against a real database.
 *
 * The domain services are unit-tested in isolation; what needs a database is the month
 * filtering (`char(7)` comparison) and organisation scoping, both of which are
 * load-bearing for correctness. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("query layer (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, lineItems, organizations } = await import("@/src/db/schema");
  const { loadExpenseAmounts, loadLineItemBudgets } = await import("./queries");

  let orgId: string;
  let otherOrgId: string;
  let lineItemId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Query Org", docName: "Query", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    orgId = org.id;

    const [other] = await db
      .insert(organizations)
      .values({ name: "Other Org", docName: "Other", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    otherOrgId = other.id;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, name: "Salary", scheduledValueCents: 100000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    const [otherItem] = await db
      .insert(lineItems)
      .values({ orgId: otherOrgId, name: "Salary", scheduledValueCents: 999999, sortOrder: 0 })
      .returning({ id: lineItems.id });

    await db.insert(expenses).values([
      { orgId, lineItemId, month: "2025-12", date: "2025-12-15", name: "Earlier year", paymentSource: "x", subtotalCents: 1000, referenceSeq: 1, taxReimbursable: false, feesReimbursable: true },
      { orgId, lineItemId, month: "2026-01", date: "2026-01-15", name: "Earlier", paymentSource: "x", subtotalCents: 2000, referenceSeq: 1, taxReimbursable: false, feesReimbursable: true },
      { orgId, lineItemId, month: "2026-02", date: "2026-02-15", name: "This month", paymentSource: "x", subtotalCents: 4000, referenceSeq: 1, taxReimbursable: false, feesReimbursable: true },
      { orgId, lineItemId, month: "2026-03", date: "2026-03-15", name: "Later", paymentSource: "x", subtotalCents: 8000, referenceSeq: 1, taxReimbursable: false, feesReimbursable: true },
      { orgId, lineItemId, month: "2026-10", date: "2026-10-15", name: "Much later", paymentSource: "x", subtotalCents: 16000, referenceSeq: 1, taxReimbursable: false, feesReimbursable: true },
      {
        orgId: otherOrgId,
        lineItemId: otherItem.id,
        month: "2026-02",
        date: "2026-02-15",
        name: "Other org expense",
        paymentSource: "x",
        subtotalCents: 500000,
        referenceSeq: 1,
        taxReimbursable: false,
        feesReimbursable: true,
      },
    ]);
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      if (id) await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  it("includes the reporting month and everything before it, excluding later months", async () => {
    const rows = await loadExpenseAmounts(orgId, "2026-02");
    expect(rows.map((row) => row.month).sort()).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("compares month keys chronologically, not lexicographically by accident", async () => {
    // "2026-10" > "2026-03" as strings and as dates — the zero-padded key makes both agree.
    const rows = await loadExpenseAmounts(orgId, "2026-03");
    expect(rows.map((row) => row.month).sort()).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);

    const all = await loadExpenseAmounts(orgId, "2026-12");
    expect(all).toHaveLength(5);
  });

  it("never returns another organisation's expenses", async () => {
    const rows = await loadExpenseAmounts(orgId, "2026-12");
    expect(rows.every((row) => row.subtotalCents !== 500000)).toBe(true);

    const otherRows = await loadExpenseAmounts(otherOrgId, "2026-02");
    expect(otherRows).toHaveLength(1);
    expect(otherRows[0].subtotalCents).toBe(500000);
  });

  it("never returns another organisation's line items", async () => {
    const items = await loadLineItemBudgets(orgId);
    expect(items).toHaveLength(1);
    expect(items[0].scheduledValueCents).toBe(100000);
  });

  it("returns line items in configured order", async () => {
    await db
      .insert(lineItems)
      .values({ orgId, name: "Analytical Support", scheduledValueCents: 5000, sortOrder: -1 });

    const items = await loadLineItemBudgets(orgId);
    expect(items.map((item) => item.name)).toEqual(["Analytical Support", "Salary"]);
  });
});
