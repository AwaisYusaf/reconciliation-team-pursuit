import "server-only";

/**
 * Funding source lookups (Phase 6, D-93). Server-only.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { cache } from "react";

import { db, type Database } from "@/src/db";
import { loadLineItemBudgets } from "@/src/db/queries";
import { fundingSources, organizations, type FundingSource } from "@/src/db/schema";
import type { FundingPosition } from "@/src/domain/funding-limit";
import { sumBy } from "@/src/domain/money";
import { fail, type ActionResult } from "@/src/lib/action-result";
import { isUuid } from "@/src/lib/ids";

/**
 * Either the pooled handle or an open transaction's handle — same trick as
 * `claimReferenceSeq` (`src/modules/expenses/references.ts`), for the same reason: a caller
 * inside `db.transaction()` must pass its `tx`, or a second pool checkout deadlocks the pool.
 */
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The organisation's default funding source: lowest `sort_order`, then oldest, non-archived.
 *
 * Was a stopgap for every Phase 1 insert path until each was taught to take an explicit
 * source (Phases 2 and 4 retired all of those). What's left is its correct permanent use:
 * `signUpAction`/`saveOnboardingFundingAction`/`saveOnboardingLineItemsAction` in
 * `src/modules/auth/actions.ts` and the two onboarding pages, where there is by construction
 * exactly one source, the one created at sign-up, so "the default" and "the only one" are the
 * same thing.
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

/** Every source, archived included, in picker order. */
export async function listFundingSources(orgId: string, reader: Executor = db): Promise<FundingSource[]> {
  return reader
    .select()
    .from(fundingSources)
    .where(eq(fundingSources.orgId, orgId))
    .orderBy(asc(fundingSources.sortOrder), asc(fundingSources.name), asc(fundingSources.id));
}

/**
 * A single source, only if it belongs to `orgId` — otherwise `null`.
 *
 * `isUuid` is checked before the query: a malformed id would otherwise reach the `id` uuid
 * column and raise Postgres 22P02 instead of a handled "not found" (same reasoning as
 * `saveLineItemAction`'s guard, `src/lib/ids.ts`).
 */
export async function findFundingSource(
  orgId: string,
  id: string,
  reader: Executor = db,
): Promise<FundingSource | null> {
  if (!isUuid(id)) return null;
  const [row] = await reader
    .select()
    .from(fundingSources)
    .where(and(eq(fundingSources.id, id), eq(fundingSources.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/**
 * A funding source's position for the funding limit (R9.6): its contract value, and the line
 * items' scheduled and new-performance totals from `loadLineItemBudgets` (the one supplier).
 *
 * `lock` (only inside a transaction) takes two row locks, in this order, before reading the
 * line items:
 * 1. the organisation row FOR KEY SHARE. Archiving (Settings and the billing sync) locks the
 *    organisation FOR UPDATE and then updates the source row; a line item insert needs a key
 *    share on the organisation for its foreign key. Taking it here first puts every path in the
 *    same order (organisation, then source), so an add and an archive queue instead of
 *    deadlocking. KEY SHARE is the lock the insert's foreign key takes anyway.
 * 2. the source row FOR NO KEY UPDATE, so every change to either side (line item base values,
 *    the onboarding line items, the contract value) queues on the same row and then reads the
 *    other's committed result. NO KEY UPDATE, not FOR UPDATE: expense and draft inserts take a
 *    key share on the source for their foreign key, and must not wait on this.
 * Null when the source isn't this organisation's. `archivedAt` comes from the locked row, so a
 * caller can re-check R14.3 after waiting.
 */
export async function loadFundingPosition(
  reader: Executor,
  orgId: string,
  fundingSourceId: string,
  lock = false,
): Promise<(FundingPosition & { archivedAt: Date | null }) | null> {
  if (lock) {
    await reader
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for("key share");
  }
  const query = reader
    .select({ contractValueCents: fundingSources.contractValueCents, archivedAt: fundingSources.archivedAt })
    .from(fundingSources)
    .where(and(eq(fundingSources.id, fundingSourceId), eq(fundingSources.orgId, orgId)));
  // The locks above come before the line items are read: under READ COMMITTED each statement
  // sees what was committed when it started, so the read after a wait sees the other side's change.
  const [row] = lock ? await query.for("no key update") : await query;
  if (!row) return null;
  const budgets = await loadLineItemBudgets(orgId, fundingSourceId, reader);
  return {
    contractValueCents: row.contractValueCents,
    scheduledCents: sumBy(budgets, (b) => b.scheduledValueCents),
    newPerformanceCents: sumBy(budgets, (b) => b.newPerformanceCents),
    archivedAt: row.archivedAt,
  };
}

export type SourceContext = {
  sources: FundingSource[];
  activeSources: FundingSource[];
  /** True when the org has exactly one source in total (archived included). */
  single: boolean;
  /** Null means "All". */
  selectedId: string | null;
};

/**
 * The header's current selection, resolved from what is stored against the signed-in person
 * (Phase 6, R2.3; per person since Phase 18).
 *
 * Wrapped in React's `cache` (not Next's `use cache`, which persists across requests and would
 * leak one org's source list into another's) so every page and action in one request shares a
 * single read, the same pattern `getSession` uses (`src/services/auth/session.ts`).
 */
export const loadSourceContext = cache(
  async (orgId: string, storedActiveId: string | null): Promise<SourceContext> => {
    const sources = await listFundingSources(orgId);
    const activeSources = sources.filter((source) => source.archivedAt === null);
    const single = sources.length === 1;

    if (single) return { sources, activeSources, single, selectedId: sources[0].id };

    // Archived allowed: history stays viewable. An id belonging to another org — or to no
    // source at all — falls back to All rather than a silent 404.
    const selectedId =
      storedActiveId && sources.some((source) => source.id === storedActiveId)
        ? storedActiveId
        : null;
    return { sources, activeSources, single, selectedId };
  },
);

export type FundingSourceOwnership = FundingSource | { denied: ActionResult<never> };

/**
 * Verify a client-supplied funding source id belongs to the session's organisation.
 *
 * Mirrors the `requireAdmin` discriminated-union idiom (`src/lib/action-session.ts`): a
 * distinct `denied` key, so a refusal here is never mistaken for an expired session by a
 * caller that only checks `"expired" in x`.
 */
export async function requireOwnedFundingSource(
  session: { orgId: string },
  id: string,
  reader: Executor = db,
): Promise<FundingSourceOwnership> {
  const source = await findFundingSource(session.orgId, id, reader);
  if (!source) return { denied: fail("Choose a funding source.") };
  return source;
}
