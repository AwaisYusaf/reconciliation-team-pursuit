/**
 * The schema guarantees behind invoice drafts (Phase 14, D-115).
 *
 * A draft is deliberately its own table rather than a flag on `expenses`, and this file is what
 * proves the guarantees that choice was made for: an unmatched line can exist with no line item,
 * a *set* line item still cannot cross funding sources, and nothing here can carry a reference
 * number because the column does not exist. Every assertion is a constraint doing its job, so a
 * constraint quietly dropped in a later migration fails the suite rather than surfacing as a bad
 * row months later. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("expense drafts schema (integration)", async () => {
  const { db } = await import("@/src/db");
  const { aiUsageEvents, expenseDrafts, expenseImports, fundingSources, lineItems, organizations } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");

  const MONTH = "2099-07";

  let orgId: string;
  let fundingSourceId: string;
  /** A second source on the same org, so the cross-source key has something to reject. */
  let otherSourceId: string;
  let lineItemId: string;
  let otherSourceLineItemId: string;
  let importId: string;

  /** A complete draft, so each test can vary the one field it is about. */
  function draft(overrides: Record<string, unknown> = {}) {
    return {
      importId,
      orgId,
      fundingSourceId,
      month: MONTH,
      date: `${MONTH}-14`,
      name: "Cable run",
      paymentSource: "Operating account",
      subtotalCents: 5_000,
      sortOrder: 0,
      ...overrides,
    };
  }

  beforeAll(async () => {
    const org = await createTestOrg({
      name: "Invoice Drafts Org",
      docName: "InvDrafts",
      activeMonth: MONTH,
    });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [other] = await db
      .insert(fundingSources)
      .values({
        id: uuidv7(),
        orgId,
        name: "Source 2",
        type: "grant",
        sortOrder: 1,
        ...ORIGINAL_RULES,
      })
      .returning({ id: fundingSources.id });
    otherSourceId = other.id;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Supplies", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    const [foreign] = await db
      .insert(lineItems)
      .values({
        orgId,
        fundingSourceId: otherSourceId,
        name: "Other supplies",
        scheduledValueCents: 100_000,
        sortOrder: 0,
      })
      .returning({ id: lineItems.id });
    otherSourceLineItemId = foreign.id;

    const [imported] = await db
      .insert(expenseImports)
      .values({
        orgId,
        fundingSourceId,
        month: MONTH,
        s3Key: `test/${uuidv7()}.pdf`,
        filename: "march-invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        pageCount: 2,
        sha256: "a".repeat(64),
      })
      .returning({ id: expenseImports.id });
    importId = imported.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("accepts a line nothing matched: no line item, no narrative", async () => {
    const [row] = await db
      .insert(expenseDrafts)
      .values(draft({ lineItemId: null, narrative: null }))
      .returning({ id: expenseDrafts.id, lineItemId: expenseDrafts.lineItemId });

    expect(row.lineItemId).toBeNull();
    await db.delete(expenseDrafts).where(eq(expenseDrafts.id, row.id));
  });

  it("refuses a line item belonging to another funding source", async () => {
    await expect(
      db.insert(expenseDrafts).values(draft({ lineItemId: otherSourceLineItemId })),
    ).rejects.toThrow();
  });

  it("refuses a month that is not YYYY-MM", async () => {
    await expect(db.insert(expenseDrafts).values(draft({ month: "2099-13" }))).rejects.toThrow();
  });

  it("holds no reference number: the column does not exist", async () => {
    const found = await db.execute(
      sql`select column_name from information_schema.columns
          where table_name = 'expense_drafts' and column_name = 'reference_seq'`,
    );
    expect(found.rows).toHaveLength(0);
  });

  it("blanks the suggestion when its line item is deleted, rather than refusing the delete", async () => {
    const [toBlank] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Doomed", scheduledValueCents: 1_000, sortOrder: 9 })
      .returning({ id: lineItems.id });

    const [row] = await db
      .insert(expenseDrafts)
      .values(draft({ lineItemId: toBlank.id }))
      .returning({ id: expenseDrafts.id });

    await db.delete(lineItems).where(eq(lineItems.id, toBlank.id));

    const [after] = await db
      .select({ lineItemId: expenseDrafts.lineItemId })
      .from(expenseDrafts)
      .where(eq(expenseDrafts.id, row.id));
    expect(after.lineItemId).toBeNull();

    await db.delete(expenseDrafts).where(eq(expenseDrafts.id, row.id));
  });

  it("removes a discarded import's drafts with it", async () => {
    const [ownImport] = await db
      .insert(expenseImports)
      .values({
        orgId,
        fundingSourceId,
        month: MONTH,
        s3Key: `test/${uuidv7()}.pdf`,
        filename: "second.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
        sha256: "b".repeat(64),
      })
      .returning({ id: expenseImports.id });

    await db.insert(expenseDrafts).values([
      draft({ importId: ownImport.id, lineItemId, sortOrder: 0 }),
      draft({ importId: ownImport.id, lineItemId: null, sortOrder: 1 }),
    ]);

    await db.delete(expenseImports).where(eq(expenseImports.id, ownImport.id));

    const left = await db
      .select({ id: expenseDrafts.id })
      .from(expenseDrafts)
      .where(eq(expenseDrafts.importId, ownImport.id));
    expect(left).toHaveLength(0);
  });

  it("logs an invoice read only with the document columns filled", async () => {
    await expect(
      db.insert(aiUsageEvents).values({
        orgId,
        feature: "invoice_read",
        outcome: "found",
        model: "test-model",
      }),
    ).rejects.toThrow();

    const [logged] = await db
      .insert(aiUsageEvents)
      .values({
        orgId,
        feature: "invoice_read",
        outcome: "found",
        model: "test-model",
        documentSource: "upload",
        documentKind: "receipt",
      })
      .returning({ id: aiUsageEvents.id });
    expect(logged.id).toBeTruthy();
  });

  it("refuses a summary outcome on an invoice read", async () => {
    await expect(
      db.insert(aiUsageEvents).values({
        orgId,
        feature: "invoice_read",
        outcome: "success",
        model: "test-model",
        documentSource: "upload",
        documentKind: "receipt",
      }),
    ).rejects.toThrow();
  });
});
