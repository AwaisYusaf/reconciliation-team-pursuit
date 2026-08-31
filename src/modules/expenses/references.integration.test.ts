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

  it("rejects reference 0 outright", async () => {
    // Defence in depth for anything reaching the table outside Drizzle.
    expect(await violatedConstraint(() => expense("Zero", 0, "2099-09"))).toBe(
      "expenses_reference_seq_ck",
    );
  });
});
