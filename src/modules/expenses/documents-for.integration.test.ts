/**
 * Phase 0 B7: the expense list reads only its own expenses' files, filtered in SQL. Each expense
 * must come back with exactly its own documents, so a query that filters the wrong column (or
 * none) fails here instead of passing silently (PR #25 review). Skipped when DATABASE_URL is
 * absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("expense documents per expense (integration, Phase 0 B7)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDocuments, expenses, lineItems, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { loadExpense, loadMonthExpenses, loadTrashedExpenses } = await import("./queries");

  const MONTH = "2099-04";
  let orgId: string;
  let fundingSourceId: string;
  const ids: Record<string, string> = {};

  async function expense(name: string, sortOrder: number, deletedAt: Date | null = null) {
    const [row] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId: ids.lineItem,
        paymentSource: "Cash",
        month: MONTH,
        date: `${MONTH}-02`,
        name,
        description: "",
        subtotalCents: 1_000,
        taxReimbursable: false,
        feesReimbursable: true,
        sortOrder,
        referenceSeq: sortOrder + 1,
        deletedAt,
      })
      .returning({ id: expenses.id });
    await db.insert(expenseDocuments).values({
      orgId,
      expenseId: row.id,
      kind: "receipt",
      status: "attached",
      s3Key: `test/${row.id}`,
      filename: `${name}.pdf`,
      mimeType: "application/pdf",
    });
    return row.id;
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: `Documents per expense ${Date.now()}` });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;
    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Supplies", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    ids.lineItem = item.id;
    ids.first = await expense("First", 0);
    ids.second = await expense("Second", 1);
    ids.trashed = await expense("Trashed", 2, new Date());
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  const filenames = (docs: Array<{ filename: string }>) => docs.map((doc) => doc.filename);

  it("the month list gives each expense its own file and no other", async () => {
    const rows = await loadMonthExpenses(orgId, fundingSourceId, MONTH);
    const byId = new Map(rows.map((row) => [row.id, filenames(row.documents)]));
    expect(byId.get(ids.first)).toEqual(["First.pdf"]);
    expect(byId.get(ids.second)).toEqual(["Second.pdf"]);
  });

  it("one expense, and the trash, read the same way", async () => {
    expect(filenames((await loadExpense(orgId, ids.second))!.documents)).toEqual(["Second.pdf"]);
    const trash = await loadTrashedExpenses(orgId, fundingSourceId);
    expect(filenames(trash.find((row) => row.id === ids.trashed)!.documents)).toEqual(["Trashed.pdf"]);
  });
});
