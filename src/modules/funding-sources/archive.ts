import "server-only";

/**
 * Archiving funding sources inside a caller's transaction: Settings' Archive button
 * (`archiveFundingSourceAction`) and the billing sync keeping one source when Reconciliation is
 * paid for (D-129). The caller holds the org row lock (`lockOrg`), so the active sources it
 * counted can't change underneath it. Revalidates nothing: the sync runs outside any request,
 * and the action revalidates for itself.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";

import { fundingSources, users } from "@/src/db/schema";
import type { Transaction } from "@/src/db/org-lock";
import { listFundingSources } from "@/src/modules/funding-sources/queries";

/**
 * Archives these sources of the org, and clears the header's funding-source selection of every
 * person in the org whose selection pointed at one of them (it would otherwise name a source the
 * picker no longer lists; per person since Phase 18). Every statement is scoped by `orgId`, so an
 * id from another org changes nothing.
 */
export async function archiveFundingSources(tx: Transaction, orgId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(fundingSources)
    .set({ archivedAt: new Date() })
    .where(and(eq(fundingSources.orgId, orgId), inArray(fundingSources.id, [...ids]), isNull(fundingSources.archivedAt)));
  await tx
    .update(users)
    .set({ activeFundingSourceId: null })
    .where(and(eq(users.orgId, orgId), inArray(users.activeFundingSourceId, [...ids])));
}

/**
 * Leaves the org one active funding source, `keepId`, and archives the rest (Reconciliation,
 * C8). When `keepId` is no longer active (archived in Settings while Checkout was open, say), the
 * first active source in the picker's order is kept instead and a line is logged: the plan's
 * limit still holds, and nothing is lost, since archived sources keep their records. Each
 * archive is logged with what was kept, since it happens in a webhook with no one watching.
 */
export async function keepOneFundingSource(tx: Transaction, orgId: string, keepId: string): Promise<void> {
  const active = (await listFundingSources(orgId, tx)).filter((source) => source.archivedAt === null);
  if (active.length <= 1) return;
  const kept = active.find((source) => source.id === keepId) ?? active[0];
  if (kept.id !== keepId) {
    console.error(`[billing] org ${orgId}: the funding source chosen at Checkout (${keepId}) is no longer active; kept ${kept.id}`);
  }
  const archive = active.filter((source) => source.id !== kept.id).map((source) => source.id);
  await archiveFundingSources(tx, orgId, archive);
  console.log(`[billing] org ${orgId}: Reconciliation paid for; kept funding source ${kept.id}, archived ${archive.join(", ")}`);
}
