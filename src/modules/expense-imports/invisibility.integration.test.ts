/**
 * A draft counts in NOTHING until it is approved (Phase 14 §6, D-115).
 *
 * This is the test the whole design exists to pass. The ticket lists nine places a draft must
 * not appear, and D-115's answer was structural: drafts live in their own table, so no query for
 * a total, a gate, a generator or the AI summary can see one, because none of them names that
 * table. A structural guarantee is only worth what its proof is worth, so this file asks each of
 * those nine questions against a real database with real drafts sitting in the same month.
 *
 * Drafts are inserted directly rather than through the import action on purpose: what is under
 * test is the guarantee, not the path that happens to create them today. If someone later adds a
 * second way to make a draft, this file still covers it.
 *
 * The strongest assertion here is the artifact cache key: if the month snapshot hashes
 * identically before and after three drafts exist, then no generator and no cached artifact can
 * see one, without this file having to know which generators exist.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("a draft is invisible until approved (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDrafts, expenseImports, expenses, lineItems, monthStatuses, organizations } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { loadExpenseAmounts, loadLineItemBudgets } = await import("@/src/db/queries");
  const { loadMonthSnapshot } = await import("@/src/generation/month-snapshot");
  const { recordsHash } = await import("@/src/generation/cache-key");
  const { loadPacketReadiness } = await import("@/src/modules/packet/queries");
  const { loadMonthFacts } = await import("@/src/modules/monthly-summary/queries");
  const { allLineItemStats } = await import("@/src/domain/budget-math");
  const { loadMonthExpenses, loadTrashedExpenses } = await import("@/src/modules/expenses/queries");

  const MONTH = "2099-08";
  /** The one real expense. Every figure below must be this and only this. */
  const LIVE_SUBTOTAL = 10_000;
  /** Three drafts at $50 each. If any of them leaks, a total moves by a number this size. */
  const DRAFT_SUBTOTAL = 5_000;

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let importId: string;

  beforeAll(async () => {
    const org = await createTestOrg({
      name: "Draft Invisibility Org",
      docName: "Invisible",
      activeMonth: MONTH,
    });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Supplies", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    await db.insert(expenses).values({
      orgId,
      fundingSourceId,
      lineItemId,
      month: MONTH,
      date: `${MONTH}-05`,
      name: "The one real expense",
      paymentSource: "Operating account",
      subtotalCents: LIVE_SUBTOTAL,
      taxReimbursable: true,
      feesReimbursable: true,
      narrative: "A real, approved expense.",
      sortOrder: 0,
      referenceSeq: await claimReferenceSeq(orgId, fundingSourceId, MONTH),
    });
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  /** Everything measurable about the month, taken the same way before and after the drafts exist. */
  async function measure() {
    const [amounts, budgets, snapshot, readiness, facts, listed, trashed] = await Promise.all([
      loadExpenseAmounts(orgId, fundingSourceId, MONTH),
      loadLineItemBudgets(orgId, fundingSourceId),
      loadMonthSnapshot(orgId, fundingSourceId, MONTH),
      loadPacketReadiness(orgId, fundingSourceId, MONTH),
      loadMonthFacts(orgId, fundingSourceId, MONTH),
      loadMonthExpenses(orgId, fundingSourceId, MONTH),
      loadTrashedExpenses(orgId, fundingSourceId),
    ]);
    return {
      amounts,
      // `contractSummary` is deliberately not measured: it is a pure function of `amounts`,
      // which is asserted identical below, so asserting it too would prove nothing new. The
      // Contract Summary screen and the workbook both reach the figures through that one call.
      stats: allLineItemStats(budgets, amounts, MONTH),
      snapshot,
      // The whole snapshot, hashed exactly as the artifact cache hashes it.
      snapshotHash: recordsHash(snapshot),
      readiness,
      facts,
      listed,
      trashed,
    };
  }

  async function nextReferenceSeq(): Promise<number> {
    const [row] = await db
      .select({ next: monthStatuses.nextReferenceSeq })
      .from(monthStatuses)
      .where(
        sql`${monthStatuses.orgId} = ${orgId} and ${monthStatuses.fundingSourceId} = ${fundingSourceId} and ${monthStatuses.month} = ${MONTH}`,
      );
    return row?.next ?? 1;
  }

  it("changes nothing anywhere when three drafts are added to the month", async () => {
    const before = await measure();
    const referenceBefore = await nextReferenceSeq();

    const [imported] = await db
      .insert(expenseImports)
      .values({
        orgId,
        fundingSourceId,
        month: MONTH,
        s3Key: `test/${uuidv7()}.pdf`,
        filename: "big-invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        pageCount: 1,
        sha256: "c".repeat(64),
      })
      .returning({ id: expenseImports.id });
    importId = imported.id;

    await db.insert(expenseDrafts).values([
      // One complete, one with no line item, one with no narrative: the three states a draft
      // can be in, so no assertion below can pass merely because the drafts were unusable.
      {
        importId,
        orgId,
        fundingSourceId,
        month: MONTH,
        date: `${MONTH}-14`,
        name: "Draft one",
        paymentSource: "Operating account",
        subtotalCents: DRAFT_SUBTOTAL,
        lineItemId,
        narrative: "Ready to approve.",
        sortOrder: 0,
      },
      {
        importId,
        orgId,
        fundingSourceId,
        month: MONTH,
        date: `${MONTH}-14`,
        name: "Draft two",
        paymentSource: "Operating account",
        subtotalCents: DRAFT_SUBTOTAL,
        lineItemId: null,
        narrative: "Needs a line item.",
        sortOrder: 1,
      },
      {
        importId,
        orgId,
        fundingSourceId,
        month: MONTH,
        date: `${MONTH}-14`,
        name: "Draft three",
        paymentSource: "Operating account",
        subtotalCents: DRAFT_SUBTOTAL,
        lineItemId,
        narrative: null,
        sortOrder: 2,
      },
    ]);

    const after = await measure();

    // 1. The month total, and therefore the dashboard, the contract summary screen and the
    //    workbook, which all read this one function.
    expect(after.amounts).toHaveLength(1);
    expect(after.amounts).toEqual(before.amounts);

    // 2. Line item spend and what is left on the line item.
    expect(after.stats).toEqual(before.stats);

    // 3. Every generator: the packet, the cover sheets and the workbook all read the snapshot,
    //    and the artifact cache keys off exactly this hash. Identical hash, identical outputs.
    expect(after.snapshot.expenses).toHaveLength(1);
    expect(after.snapshotHash).toBe(before.snapshotHash);

    // 4. The documentation gate (R4.3). Two of the three drafts have no receipt; if any reached
    //    the gate the month would be blocked and the packet could never be downloaded.
    expect(after.readiness.blocking).toEqual(before.readiness.blocking);
    expect(after.readiness.totalRecords).toBe(before.readiness.totalRecords);

    // 5. The AI monthly summary reads the facts, and its "records changed" notice keys off this
    //    fingerprint. A draft must not make a written summary look stale.
    expect(after.facts?.fingerprint).toBe(before.facts?.fingerprint);
    expect(after.facts?.facts.overview.expenseCount).toBe(1);

    // 6. No reference number is spent. The counter is untouched until an approval claims one.
    expect(await nextReferenceSeq()).toBe(referenceBefore);

    // 7. The month's expenses list holds only the real expense; the drafts render in their own
    //    section from their own query.
    expect(after.listed).toHaveLength(1);

    // 8. A draft is not in Trash and never will be: discarding deletes the row (ticket §5).
    expect(after.trashed).toHaveLength(0);
  });

  it("appears in all of them once it is approved, and takes exactly one reference number", async () => {
    const before = await measure();
    const referenceBefore = await nextReferenceSeq();

    // Approval as the action performs it: claim a reference, insert a real expense, drop the
    // draft. Done here directly so this file tests the guarantee rather than the action's wiring.
    const [ready] = await db
      .select({ id: expenseDrafts.id, name: expenseDrafts.name })
      .from(expenseDrafts)
      .where(eq(expenseDrafts.importId, importId))
      .orderBy(expenseDrafts.sortOrder)
      .limit(1);

    await db.insert(expenses).values({
      orgId,
      fundingSourceId,
      lineItemId,
      month: MONTH,
      date: `${MONTH}-14`,
      name: ready.name,
      paymentSource: "Operating account",
      subtotalCents: DRAFT_SUBTOTAL,
      taxReimbursable: true,
      feesReimbursable: true,
      narrative: "Ready to approve.",
      sortOrder: 1,
      referenceSeq: await claimReferenceSeq(orgId, fundingSourceId, MONTH),
    });
    await db.delete(expenseDrafts).where(eq(expenseDrafts.id, ready.id));

    const after = await measure();

    // Now it counts, everywhere it did not before.
    expect(after.amounts).toHaveLength(2);
    expect(after.snapshot.expenses).toHaveLength(2);
    expect(after.snapshotHash).not.toBe(before.snapshotHash);
    expect(after.facts?.fingerprint).not.toBe(before.facts?.fingerprint);
    expect(after.facts?.facts.overview.expenseCount).toBe(2);
    expect(after.listed).toHaveLength(2);

    // Exactly one number, claimed at approval and not before.
    expect(await nextReferenceSeq()).toBe(referenceBefore + 1);

    // And it now carries the documentation gate like any other expense: it has no receipt, so
    // it blocks, which is the proof that approving really did make it a real record.
    expect(after.readiness.blocking.length).toBeGreaterThan(before.readiness.blocking.length);
  });

  it("removes every remaining draft with its import, leaving the month's figures untouched", async () => {
    const before = await measure();

    await db.delete(expenseImports).where(eq(expenseImports.id, importId));

    const left = await db
      .select({ id: expenseDrafts.id })
      .from(expenseDrafts)
      .where(eq(expenseDrafts.importId, importId));
    expect(left).toHaveLength(0);

    const after = await measure();
    expect(after.amounts).toEqual(before.amounts);
    expect(after.snapshotHash).toBe(before.snapshotHash);
  });
});
