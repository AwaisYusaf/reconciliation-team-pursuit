import "server-only";

/**
 * Which parts of a receipt a funder reimburses (R1.3, D-67).
 *
 * Its own module so every path that creates an expense resolves the flags the same way. The
 * expense form and the recurring one-click add previously disagreed: the form inherited the
 * payment source's rules while the add fell through to the column defaults, so the identical
 * expense under the identical funder claimed a different amount depending on how it was
 * entered.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/src/db";
import { paymentSources } from "@/src/db/schema";

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

/** What this funder reimburses, by payment source label. */
export async function reimbursementRulesFor(
  orgId: string,
  label: string | null | undefined,
): Promise<ReimbursementRules> {
  if (!label) return ORIGINAL_RULES;

  const [source] = await db
    .select({
      taxReimbursable: paymentSources.taxReimbursable,
      feesReimbursable: paymentSources.feesReimbursable,
    })
    .from(paymentSources)
    .where(and(eq(paymentSources.orgId, orgId), eq(paymentSources.label, label)))
    .limit(1);

  return source ?? ORIGINAL_RULES;
}
