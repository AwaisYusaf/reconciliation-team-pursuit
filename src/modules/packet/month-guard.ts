import "server-only";

/**
 * The month-lock guard (R10.7, D-96).
 *
 * Its own file, importing nothing but the database, because both the lock itself
 * (`./lock.ts`) and the upload ingestion it shares helpers with
 * (`src/services/storage/documents.ts`) need it — kept in `lock.ts`, those two imported each
 * other.
 */
import { and, eq } from "drizzle-orm";

import type { Database } from "@/src/db";
import { monthStatuses } from "@/src/db/schema";
import type { MonthKey } from "@/src/domain/dates";

/** Either the pooled handle or an open transaction's handle — same trick as `claimReferenceSeq`
 *  (`src/modules/expenses/references.ts`). */
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export type MonthRef = { fundingSourceId: string; month: MonthKey };

/**
 * Whether any of the given `(fundingSourceId, month)` pairs is locked — the guard every
 * protected write runs first, inside its own transaction (plan §3.2–§3.3).
 *
 * For each entry, in sorted key order: `INSERT … ON CONFLICT DO NOTHING` (so a month with no
 * row yet is created before it is locked — without this, a `SELECT … FOR UPDATE` against a
 * not-yet-existing row does not wait on another transaction's uncommitted insert of it), then
 * `SELECT locked_at … FOR UPDATE`. Sorted, deduplicated order is what keeps a move touching two
 * months deadlock-free against a concurrent lock touching the same two months.
 *
 * **Must run on the caller's own transaction** — a second pool checkout while one is already
 * held can deadlock the pool (same reasoning as `claimReferenceSeq`).
 *
 * Returns the first locked entry, or `null`. Every row is still locked before returning, so the
 * caller's transaction holds all of them either way. Returning *which* month rather than a bare
 * boolean is what lets a move name the month that actually refused it: moving an expense out of a
 * locked March into an open April must say "March 2026 is locked", not "April".
 */
export async function monthLocked(
  tx: Executor,
  orgId: string,
  entries: MonthRef[],
): Promise<MonthRef | null> {
  const unique = new Map<string, MonthRef>();
  for (const entry of entries) unique.set(`${entry.fundingSourceId}:${entry.month}`, entry);
  const sorted = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  let locked: MonthRef | null = null;
  for (const [, entry] of sorted) {
    await tx
      .insert(monthStatuses)
      .values({ orgId, fundingSourceId: entry.fundingSourceId, month: entry.month })
      .onConflictDoNothing();

    const [row] = await tx
      .select({ lockedAt: monthStatuses.lockedAt })
      .from(monthStatuses)
      .where(
        and(
          eq(monthStatuses.orgId, orgId),
          eq(monthStatuses.fundingSourceId, entry.fundingSourceId),
          eq(monthStatuses.month, entry.month),
        ),
      )
      .for("update");
    if (row?.lockedAt && !locked) locked = entry;
  }
  return locked;
}
