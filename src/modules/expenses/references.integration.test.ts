/**
 * Reference allocation against a real database (R2.6).
 *
 * These need Postgres because everything load-bearing here is enforced *by* Postgres: the
 * atomic upsert that advances the counter, the unique index on (org, month, reference_seq),
 * and the check that keeps 0 out. Skipped when DATABASE_URL is absent.
 *
 * The last two tests are the regression: the recurring one-click add shipped without calling
 * `claimReferenceSeq`, so every added expense took the old column default of 0 and the second
 * add into a month failed on the unique index.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("expense references (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, lineItems, organizations } = await import("@/src/db/schema");
  const { claimReferenceSeq } = await import("./references");

  let orgId: string;
  let lineItemId: string;

  const MONTH = "2099-03";
  const OTHER_MONTH = "2099-04";

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Reference Org", docName: "Ref", activeMonth: MONTH })
      .returning({ id: organizations.id });
    orgId = org.id;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, name: "Transportation", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  /**
   * The constraint a write violated, or null if it succeeded.
   *
   * Drizzle wraps the driver error, so its own message is only the failed SQL — the
   * constraint name lives on the pg error underneath. Asserting on the name rather than on
   * "it threw" is what makes these tests prove the *right* guard fired.
   */
  async function violatedConstraint(write: () => Promise<unknown>): Promise<string | null> {
    try {
      await write();
      return null;
    } catch (error) {
      const cause = (error as { cause?: { constraint?: string } }).cause;
      return cause?.constraint ?? null;
    }
  }

  function expense(name: string, referenceSeq: number, month = MONTH) {
    return db.insert(expenses).values({
      orgId,
      lineItemId,
      month,
      date: `${month}-01`,
      name,
      paymentSource: "x",
      subtotalCents: 1000,
      sortOrder: referenceSeq,
      referenceSeq,
      // Explicit since the columns lost their defaults (D-71): an insert that omits them no
      // longer compiles, which is the point.
      taxReimbursable: false,
      feesReimbursable: true,
    });
  }

  it("starts at 1 and never hands out 0", async () => {
    // 0 was the old column default, and the number the bug stamped on every recurring add.
    expect(await claimReferenceSeq(orgId, MONTH)).toBe(1);
  });

  it("advances by one on each claim", async () => {
    expect(await claimReferenceSeq(orgId, MONTH)).toBe(2);
    expect(await claimReferenceSeq(orgId, MONTH)).toBe(3);
  });

  it("counts independently per month", async () => {
    expect(await claimReferenceSeq(orgId, OTHER_MONTH)).toBe(1);
  });

  it("never repeats a number under concurrent claims", async () => {
    // The counter is advanced by the upsert itself, under its own row lock — this is what
    // makes retry logic unnecessary.
    const claimed = await Promise.all(
      Array.from({ length: 10 }, () => claimReferenceSeq(orgId, "2099-05")),
    );
    expect(new Set(claimed).size).toBe(10);
    expect(Math.min(...claimed)).toBe(1);
    expect(Math.max(...claimed)).toBe(10);
  });

  it("lets two expenses claimed in the same month both save", async () => {
    // The exact shape that failed: two one-click recurring adds into one month.
    const first = await claimReferenceSeq(orgId, "2099-06");
    await expense("Recurring A", first, "2099-06");
    const second = await claimReferenceSeq(orgId, "2099-06");
    await expense("Recurring B", second, "2099-06");

    const rows = await db
      .select({ referenceSeq: expenses.referenceSeq })
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.month, "2099-06")));

    expect(rows.map((row) => row.referenceSeq).sort()).toEqual([1, 2]);
  });

  it("rejects a second expense reusing a reference in the same month", async () => {
    await expense("First", 1, "2099-08");
    expect(await violatedConstraint(() => expense("Duplicate", 1, "2099-08"))).toBe(
      "expenses_org_month_reference_uq",
    );
  });

  it("moves everything with the expense and reissues the reference (R2.6, D-61)", async () => {
    // The client's report was that a mis-filed expense had to be deleted and rebuilt. It does
    // not: the month is editable and everything hangs off the expense id. This pins that.
    const { expenseDocuments } = await import("@/src/db/schema");

    const from = "2099-10";
    const to = "2099-11";
    const seq = await claimReferenceSeq(orgId, from);
    const [moved] = await db
      .insert(expenses)
      .values({
        orgId,
        lineItemId,
        taxReimbursable: false,
        feesReimbursable: true,
        month: from,
        date: `${from}-14`,
        name: "Conference travel",
        description: "Two nights",
        narrative: "Sent two outreach workers to the state CVI convening.",
        note: "Split with partner org",
        paymentSource: "x",
        subtotalCents: 40_000,
        taxCents: 2_400,
        feesCents: 1_500,
        sortOrder: seq,
        referenceSeq: seq,
      })
      .returning({ id: expenses.id });

    await db.insert(expenseDocuments).values({
      orgId,
      expenseId: moved.id,
      kind: "receipt",
      status: "attached",
      s3Key: `org/${orgId}/months/${from}/expenses/${moved.id}/receipt/doc.pdf`,
      filename: "hotel.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4096,
      pageCount: 2,
      sortOrder: 0,
    });

    // Occupy the destination's first reference, so a naive move would collide.
    await expense("Already there", await claimReferenceSeq(orgId, to), to);

    const destinationSeq = await claimReferenceSeq(orgId, to);
    await db
      .update(expenses)
      .set({ month: to, referenceSeq: destinationSeq })
      .where(eq(expenses.id, moved.id));

    const [after] = await db
      .select({
        month: expenses.month,
        referenceSeq: expenses.referenceSeq,
        narrative: expenses.narrative,
        note: expenses.note,
        description: expenses.description,
        lineItemId: expenses.lineItemId,
        taxCents: expenses.taxCents,
        feesCents: expenses.feesCents,
      })
      .from(expenses)
      .where(eq(expenses.id, moved.id));

    expect(after.month).toBe(to);
    // A new number from the destination's counter, not the one it held in the source month.
    expect(after.referenceSeq).not.toBe(seq);
    expect(after.referenceSeq).toBe(destinationSeq);

    // Everything the client listed travels with it, because it hangs off the expense row.
    expect(after.narrative).toContain("outreach workers");
    expect(after.note).toBe("Split with partner org");
    expect(after.description).toBe("Two nights");
    expect(after.lineItemId).toBe(lineItemId);
    expect(after.taxCents).toBe(2_400);
    expect(after.feesCents).toBe(1_500);

    // Documents follow by foreign key; their keys keep the old month segment, which is a
    // stored address rather than a lookup path (Q2).
    const documents = await db
      .select({ s3Key: expenseDocuments.s3Key, pageCount: expenseDocuments.pageCount })
      .from(expenseDocuments)
      .where(eq(expenseDocuments.expenseId, moved.id));
    expect(documents).toHaveLength(1);
    expect(documents[0].pageCount).toBe(2);
    expect(documents[0].s3Key).toContain(`/months/${from}/`);

    // The source month keeps its gap: the number it held is never reissued.
    const sourceRows = await db
      .select({ referenceSeq: expenses.referenceSeq })
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.month, from)));
    expect(sourceRows).toHaveLength(0);
    expect(await claimReferenceSeq(orgId, from)).toBeGreaterThan(seq);
  });

  it("rejects reference 0 outright", async () => {
    // Defence in depth for anything reaching the table outside Drizzle.
    expect(await violatedConstraint(() => expense("Zero", 0, "2099-09"))).toBe(
      "expenses_reference_seq_ck",
    );
  });
});
