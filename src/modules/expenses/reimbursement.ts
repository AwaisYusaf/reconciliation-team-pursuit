import "server-only";

/**
 * Which parts of a receipt a funder reimburses (R1.3, D-67, Phase 4/D-93).
 *
 * Its own module so every path that creates an expense resolves the flags the same way. The
 * expense form and the recurring one-click add previously disagreed: the form inherited the
 * payment source's rules while the add fell through to the column defaults, so the identical
 * expense under the identical funder claimed a different amount depending on how it was
 * entered. From Phase 4 on the rules come from the **funding source**, not the payment
 * source — a payment source is only how something was paid (R5.1/R5.2).
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/src/db";
import { fundingSources } from "@/src/db/schema";

export type ReimbursementRules = {
  taxReimbursable: boolean;
  feesReimbursable: boolean;
};

/**
 * The original rule — tax excluded, fees included — used when a source cannot be resolved.
 *
 * A fallback rather than a guess: it is what every expense claimed before funders could
 * differ, so an unknown source can only ever under-claim, never over-claim. Over-claiming is
 * the failure that costs the organisation its credibility with the funder.
 */
export const ORIGINAL_RULES: ReimbursementRules = {
  taxReimbursable: false,
  feesReimbursable: true,
};

/** What this funding source reimburses. */
export async function rulesForFundingSource(
  orgId: string,
  fundingSourceId: string | null | undefined,
): Promise<ReimbursementRules> {
  if (!fundingSourceId) return ORIGINAL_RULES;

  const [source] = await db
    .select({
      taxReimbursable: fundingSources.taxReimbursable,
      feesReimbursable: fundingSources.feesReimbursable,
    })
    .from(fundingSources)
    .where(and(eq(fundingSources.orgId, orgId), eq(fundingSources.id, fundingSourceId)))
    .limit(1);

  return source ?? ORIGINAL_RULES;
}
