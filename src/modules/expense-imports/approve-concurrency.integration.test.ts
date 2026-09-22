/**
 * One draft can only ever become one expense (Phase 14 §7).
 *
 * Two people pressing Approve on the same draft at the same moment, or one person
 * double-clicking, must not produce two expenses and must not spend two reference numbers.
 *
 * Both tests here drive the REAL `approveDraftAction` (and, in the second, the REAL
 * `discardDraftAction`) — not a hand-rolled re-implementation of either transaction, which would
 * stay green even if a lock were deleted from the real code.
 *
 * Two different races, two different guarantees:
 *
 * - approve vs. approve (first test): fully serialized by `monthLocked`'s own
 *   `SELECT ... FOR UPDATE` on `month_statuses`, which both calls hit identically before either
 *   reaches the draft row's own `.for("update")` — proven by mutation to be redundant for THIS
 *   race specifically (removing the draft row lock alone did not make this test fail across
 *   repeated runs; see the report).
 * - approve vs. discard (second test): `discardDraftAction` deliberately takes no month lock (see
 *   its own docstring), so `monthLocked` cannot serialize it against a concurrent approval. The
 *   draft row's `.for("update")` is what has to prevent an approval and a discard both succeeding
 *   on the same draft at once — proven by mutation below to be genuinely load-bearing for this
 *   race: removed, "both succeeded" (the duplicate-expense danger, since discard's returned
 *   `DiscardedDraft` carries an Undo) reproduced in roughly a third to three quarters of 25-run
 *   trials; restored, zero forbidden outcomes across 125 further iterations.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("approving one draft twice at once (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDrafts, expenseImports, expenses, lineItems, monthStatuses, organizations, users } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  const { approveDraftAction, discardDraftAction } = await import("./draft-actions");

  const session = vi.mocked(actionSession);

  const MONTH = "2099-12";

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let importId: string;
  let userId: string;

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

    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `approve-race-${Date.now()}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    userId = user.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  function asOrg() {
    session.mockResolvedValue({
      orgId,
      userId,
      email: "e@example.com",
      role: "admin",
      orgName: "Org",
      docName: "Doc",
      activeMonth: MONTH,
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    });
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

  it("makes one expense and spends one reference number, not two", async () => {
    asOrg();

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

    // Both at once, driving the REAL action, neither awaited before the other starts.
    const [first, second] = await Promise.all([
      approveDraftAction(draft.id),
      approveDraftAction(draft.id),
    ]);

    const outcomes = [first.ok, second.ok].sort();
    expect(outcomes).toEqual([false, true]);

    const made = await db
      .select({ id: expenses.id, referenceSeq: expenses.referenceSeq })
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.month, MONTH)));
    expect(made).toHaveLength(1);

    // Exactly one number spent, and it is the one the winning call claimed.
    expect(await nextReferenceSeq()).toBe(before + 1);
    expect(made[0].referenceSeq).toBe(before);

    // And the draft is gone, not left behind for someone to approve a second time.
    const left = await db
      .select({ id: expenseDrafts.id })
      .from(expenseDrafts)
      .where(eq(expenseDrafts.id, draft.id));
    expect(left).toHaveLength(0);
  });

  /**
   * The race `.for("update")` on the draft row actually guards, per the coordinator's own
   * analysis: approve-vs-approve is already fully serialized by `monthLocked`'s own
   * `SELECT ... FOR UPDATE` on `month_statuses`, which both calls hit identically before either
   * reaches the draft's own lock — that lock is provably redundant for that race (see the
   * report). `discardDraftAction` deliberately takes NO month lock (its own docstring: "a draft
   * is in no month total, so removing one changes nothing a lock protects"), so it never
   * contends on `month_statuses` and cannot be serialized against an approval by that path.
   * The draft row's own `.for("update")` is what has to prevent: an approval reading the draft,
   * a concurrent discard deleting it out from under that approval, and the discard returning a
   * `DiscardedDraft` payload (with an Undo) for a draft that was, at the same moment, turned into
   * a real expense — which Undo would then let someone approve a second time.
   *
   * Timing-dependent by nature (two real transactions racing on a real connection pool), so this
   * runs many independent iterations, each on its own fresh draft, and every iteration must land
   * on one of the two acceptable outcomes — never the forbidden one.
   */
  async function insertContestedDraft(name: string) {
    const [draft] = await db
      .insert(expenseDrafts)
      .values({
        importId,
        orgId,
        fundingSourceId,
        month: MONTH,
        date: `${MONTH}-15`,
        name,
        paymentSource: "Operating account",
        subtotalCents: 4_200,
        lineItemId,
        narrative: "Contested between approve and discard.",
        sortOrder: 0,
      })
      .returning({ id: expenseDrafts.id });
    return draft.id;
  }

  const RACE_ITERATIONS = 25;

  it(`approve-vs-discard: exactly one wins, never both, across ${RACE_ITERATIONS} runs`, async () => {
    asOrg();
    await db
      .insert(monthStatuses)
      .values({ orgId, fundingSourceId, month: MONTH })
      .onConflictDoNothing();

    let approveWon = 0;
    let discardWon = 0;
    const bothSucceeded: number[] = [];
    const bothFailed: number[] = [];

    for (let i = 0; i < RACE_ITERATIONS; i++) {
      const draftName = `Contested race ${i}`;
      const draftId = await insertContestedDraft(draftName);

      const [approveResult, discardResult] = await Promise.all([
        approveDraftAction(draftId),
        discardDraftAction(draftId),
      ]);

      // Matched by this iteration's own unique name, not a bare count of the org/month: the
      // FIRST test in this file (approve-vs-approve) leaves its own expense behind in the same
      // org and month, which a plain count would double-count from iteration 0 onward.
      const madeExpenses = await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.orgId, orgId), eq(expenses.month, MONTH), eq(expenses.name, draftName)));
      const expenseCreatedThisRun = madeExpenses.length > 0;

      const draftRow = await db
        .select({ id: expenseDrafts.id })
        .from(expenseDrafts)
        .where(eq(expenseDrafts.id, draftId));
      const draftStillThere = draftRow.length > 0;

      // The forbidden state: approve succeeded (an expense exists) AND discard also succeeded
      // (it returned a DiscardedDraft the client would offer an Undo for). Either alone, or
      // neither, is fine; both together means the same draft became a real expense while also
      // handing back an undo payload that can plant a second, duplicate one.
      if (approveResult.ok && discardResult.ok) {
        bothSucceeded.push(i);
      } else if (approveResult.ok) {
        approveWon++;
        expect(expenseCreatedThisRun).toBe(true);
        expect(draftStillThere).toBe(false);
        // Discard lost cleanly: no DiscardedDraft payload exists for anyone to Undo.
        expect(discardResult.ok).toBe(false);
      } else if (discardResult.ok) {
        discardWon++;
        expect(expenseCreatedThisRun).toBe(false);
        expect(draftStillThere).toBe(false);
        expect(approveResult.ok).toBe(false);
      } else {
        // Neither winning and both failing is not the duplicate-expense danger this test is
        // about (no expense, no Undo payload — nothing to double-approve), but it is also not a
        // documented outcome of a single ready, unlocked, unarchived draft, so it is recorded
        // and still fails the test rather than being silently accepted.
        bothFailed.push(i);
      }

      // Clean up whatever THIS iteration left (matched by its own unique name, never a bare
      // org/month delete — that would also remove the earlier "approve twice" test's own
      // expense) before the next iteration's own draft is created.
      await db
        .delete(expenses)
        .where(and(eq(expenses.orgId, orgId), eq(expenses.month, MONTH), eq(expenses.name, draftName)));
      await db.delete(expenseDrafts).where(eq(expenseDrafts.id, draftId));
    }

    // Only on a bad run. Which side wins is timing, and printing the split on every green run
    // would be noise in the suite output; the breakdown is worth having when it does break,
    // because it says whether the race went wrong the dangerous way or merely stalled.
    if (bothSucceeded.length > 0 || bothFailed.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `approve-vs-discard race over ${RACE_ITERATIONS} runs: approve won ${approveWon}, ` +
          `discard won ${discardWon}, BOTH SUCCEEDED (the duplicate-expense danger) ${bothSucceeded.length} ` +
          `(iterations ${bothSucceeded.join(", ")}), both failed ${bothFailed.length} (iterations ${bothFailed.join(", ")})`,
      );
    }

    // The dangerous case gets its own named assertion, so a failure report says exactly what
    // went wrong rather than lumping it in with the (harmless but still unexpected) both-failed
    // case.
    expect(bothSucceeded, "approve and discard BOTH succeeded on the same draft").toEqual([]);
    expect(bothFailed, "approve and discard BOTH failed on a single ready draft").toEqual([]);

    // Not asserted as a hard requirement (a fast machine or connection pool could legitimately
    // let one side win every time without the guard being untested — the mutual-exclusion
    // checks above are what actually prove the lock), but reported for the record.
  });
});
