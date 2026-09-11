/**
 * Funding source lookups (Phase 6, D-93). Server-only.
 */
import { and, asc, eq, isNull } from "drizzle-orm";

import { db, type Database } from "@/src/db";
import { fundingSources } from "@/src/db/schema";

/**
 * Either the pooled handle or an open transaction's handle — same trick as
 * `claimReferenceSeq` (`src/modules/expenses/references.ts`), for the same reason: a caller
 * inside `db.transaction()` must pass its `tx`, or a second pool checkout deadlocks the pool.
 */
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

// ponytail: bridge until Phase 2 passes the selected source; delete in Phase 4
/**
 * The organisation's default funding source: lowest `sort_order`, then oldest, non-archived.
 * Every Phase 1 insert path that hasn't yet been taught to take an explicit source uses this.
 */
export async function primaryFundingSourceId(orgId: string, reader: Executor = db): Promise<string> {
  const [row] = await reader
    .select({ id: fundingSources.id })
    .from(fundingSources)
    .where(and(eq(fundingSources.orgId, orgId), isNull(fundingSources.archivedAt)))
    .orderBy(asc(fundingSources.sortOrder), asc(fundingSources.createdAt))
    .limit(1);
  if (!row) throw new Error(`Organisation ${orgId} has no active funding source.`);
  return row.id;
}
