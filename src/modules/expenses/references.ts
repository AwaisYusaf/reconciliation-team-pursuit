/**
 * Expense reference numbers (R2.6).
 *
 * Deliberately its own module rather than a helper inside `actions.ts`: that file is
 * `"use server"`, where every export becomes a callable endpoint. A counter that hands out
 * reference numbers must not be one.
 */
import { sql } from "drizzle-orm";

import { db, type Database } from "@/src/db";
import { monthStatuses } from "@/src/db/schema";
import type { MonthKey } from "@/src/domain/dates";

/**
 * Either the pooled handle or an open transaction's handle.
 *
 * Derived from `Database["transaction"]`'s own callback parameter rather than naming a
 * Drizzle internal, so it cannot drift from whatever `db.transaction()` actually hands out.
 */
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Claim the next reference number for a source, per month (R2.6, D-93 decision 2.6).
 *
 * One statement, so the counter is read and advanced under the same row lock: two saves in
 * the same source's month cannot be handed the same number, and nothing has to detect a
 * collision and retry. Deleting an expense leaves its number spent — a reference that has
 * been printed is never handed to something else.
 *
 * `month_statuses` gains a row here if the (source, month) has none. That is harmless: its
 * other columns are `submitted_at` and `locked_at`, and a row with both null already means
 * exactly what no row means.
 *
 * **Every path that inserts an expense must call this.** `reference_seq` has no column
 * default precisely so that forgetting is a compile error rather than two rows colliding on
 * `expenses_org_month_reference_uq` at run time — which is what shipped when the recurring
 * one-click add was written without it.
 *
 * **A caller inside `db.transaction()` must pass its `tx`.** Left on the default, this would
 * check a *second* connection out of the same 10-slot pool while the caller's transaction
 * still holds the first — ten concurrent saves would then each hold one and wait forever for
 * another, deadlocking the pool. Passing `tx` also makes the claim roll back with the
 * transaction instead of spending a number the failed insert never used.
 */
export async function claimReferenceSeq(
  orgId: string,
  fundingSourceId: string,
  month: MonthKey,
  executor: Executor = db,
): Promise<number> {
  const [claimed] = await executor
    .insert(monthStatuses)
    .values({ orgId, fundingSourceId, month, nextReferenceSeq: 2 })
    .onConflictDoUpdate({
      target: [monthStatuses.orgId, monthStatuses.fundingSourceId, monthStatuses.month],
      set: { nextReferenceSeq: sql`${monthStatuses.nextReferenceSeq} + 1` },
    })
    .returning({ next: monthStatuses.nextReferenceSeq });

  // The row now holds the *next* number, so the one just claimed is one below it.
  return Number(claimed.next) - 1;
}
