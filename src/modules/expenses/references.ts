/**
 * Expense reference numbers (R2.6).
 *
 * Deliberately its own module rather than a helper inside `actions.ts`: that file is
 * `"use server"`, where every export becomes a callable endpoint. A counter that hands out
 * reference numbers must not be one.
 */
import { sql } from "drizzle-orm";

import { db } from "@/src/db";
import { monthStatuses } from "@/src/db/schema";
import type { MonthKey } from "@/src/domain/dates";

/**
 * Claim the next reference number for a month (R2.6).
 *
 * One statement, so the counter is read and advanced under the same row lock: two saves in
 * the same month cannot be handed the same number, and nothing has to detect a collision and
 * retry. Deleting an expense leaves its number spent — a reference that has been printed is
 * never handed to something else.
 *
 * `month_statuses` gains a row here if the month has none. That is harmless: the only other
 * column is `submitted_at`, and a row with it null already means exactly what no row means.
 *
 * **Every path that inserts an expense must call this.** `reference_seq` has no column
 * default precisely so that forgetting is a compile error rather than two rows colliding on
 * `expenses_org_month_reference_uq` at run time — which is what shipped when the recurring
 * one-click add was written without it.
 */
export async function claimReferenceSeq(orgId: string, month: MonthKey): Promise<number> {
  const [claimed] = await db
    .insert(monthStatuses)
    .values({ orgId, month, nextReferenceSeq: 2 })
    .onConflictDoUpdate({
      target: [monthStatuses.orgId, monthStatuses.month],
      set: { nextReferenceSeq: sql`${monthStatuses.nextReferenceSeq} + 1` },
    })
    .returning({ next: monthStatuses.nextReferenceSeq });

  // The row now holds the *next* number, so the one just claimed is one below it.
  return Number(claimed.next) - 1;
}
