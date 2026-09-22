/**
 * One draft can only ever become one expense (Phase 14 §7).
 *
 * Two people pressing Approve on the same draft at the same moment, or one person
 * double-clicking, must not produce two expenses and must not spend two reference numbers. The
 * guarantee is `.for("update")` on the draft row inside the approving transaction: the second
 * transaction blocks on the lock, and once the first commits its delete, the second re-reads and
 * finds nothing to approve.
 *
 * That is a load-bearing lock with no test of its own, which is how it would quietly stop being
 * load-bearing. Money correctness, so it gets one.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("approving one draft twice at once (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDrafts, expenseImports, expenses, lineItems, monthStatuses, organizations } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");

  const MONTH = "2099-11";

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let importId: string;

  beforeAll(async () => {
    const org = await createTestOrg({
      name: "Approve Race Org",
      docName: "ApproveRace",
      activeMonth: MONTH,
    });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Supplies", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    const [imported] = await db
      .insert(expenseImports)
      .values({
        orgId,
        fundingSourceId,
        month: MONTH,
        s3Key: `test/race-${Date.now()}.pdf`,
        filename: "race.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        pageCount: 1,
        sha256: "d".repeat(64),
      })
      .returning({ id: expenseImports.id });
    importId = imported.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  async function nextReferenceSeq(): Promise<number> {
    const [row] = await db
      .select({ next: monthStatuses.nextReferenceSeq })
      .from(monthStatuses)
      .where(
        sql`${monthStatuses.orgId} = ${orgId} and ${monthStatuses.fundingSourceId} = ${fundingSourceId} and ${monthStatuses.month} = ${MONTH}`,
      );
    return row?.next ?? 1;
  }

  /**
   * The approving transaction's shape, reduced to the part the race turns on: take the draft
   * FOR UPDATE, and if it is still there, insert the expense and delete the draft. The real
   * action does more around this, none of which changes who wins.
   */
  async function approve(draftId: string): Promise<"approved" | "gone"> {
    return db.transaction(async (tx) => {
      const [draft] = await tx
        .select()
        .from(expenseDrafts)
        .where(and(eq(expenseDrafts.id, draftId), eq(expenseDrafts.orgId, orgId)))
        .for("update");
      if (!draft) return "gone";

      const [{ next }] = await tx
        .select({ next: sql<number>`next_reference_seq` })
        .from(monthStatuses)
        .where(
          sql`${monthStatuses.orgId} = ${orgId} and ${monthStatuses.fundingSourceId} = ${fundingSourceId} and ${monthStatuses.month} = ${MONTH}`,
        )
        .for("update");

      await tx
        .update(monthStatuses)
        .set({ nextReferenceSeq: Number(next) + 1 })
        .where(
          sql`${monthStatuses.orgId} = ${orgId} and ${monthStatuses.fundingSourceId} = ${fundingSourceId} and ${monthStatuses.month} = ${MONTH}`,
        );

      await tx.insert(expenses).values({
        orgId,
        fundingSourceId,
        lineItemId: draft.lineItemId!,
        month: draft.month,
        date: draft.date,
        name: draft.name,
        paymentSource: draft.paymentSource,
        subtotalCents: draft.subtotalCents,
        taxReimbursable: true,
        feesReimbursable: true,
        narrative: draft.narrative,
        sortOrder: 0,
        referenceSeq: Number(next),
      });

      await tx.delete(expenseDrafts).where(eq(expenseDrafts.id, draftId));
      return "approved";
    });
  }

  it("makes one expense and spends one reference number, not two", async () => {
    // The month_statuses row has to exist before either transaction locks it, exactly as
    // `monthLocked` creates it at the top of the real approval.
    await db
      .insert(monthStatuses)
      .values({ orgId, fundingSourceId, month: MONTH })
      .onConflictDoNothing();

    const [draft] = await db
      .insert(expenseDrafts)
      .values({
        importId,
        orgId,
        fundingSourceId,
        month: MONTH,
        date: `${MONTH}-14`,
        name: "Contested draft",
        paymentSource: "Operating account",
        subtotalCents: 7_500,
        lineItemId,
        narrative: "Approved by whoever got there first.",
        sortOrder: 0,
      })
      .returning({ id: expenseDrafts.id });

    const before = await nextReferenceSeq();

    // Both at once, neither awaited before the other starts. One must lose.
    const [first, second] = await Promise.all([approve(draft.id), approve(draft.id)]);

    const outcomes = [first, second].sort();
    expect(outcomes).toEqual(["approved", "gone"]);

    const made = await db
      .select({ id: expenses.id, referenceSeq: expenses.referenceSeq })
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.month, MONTH)));
    expect(made).toHaveLength(1);

    // Exactly one number spent, and it is the one the winning transaction claimed.
    expect(await nextReferenceSeq()).toBe(before + 1);
    expect(made[0].referenceSeq).toBe(before);

    // And the draft is gone, not left behind for someone to approve a second time.
    const left = await db
      .select({ id: expenseDrafts.id })
      .from(expenseDrafts)
      .where(eq(expenseDrafts.id, draft.id));
    expect(left).toHaveLength(0);
  });
});
