import "server-only";

/**
 * Access gate for reading amounts from documents (Phase 10, D-105).
 *
 * `canReadAmounts` is the one place the plan, the Settings switch and the server's OpenAI
 * configuration are combined — every consumer (Add/Edit pages, the read route, the tour) calls
 * `readAmountsAllowedForOrg`, so there is exactly one answer to "is this org allowed to use
 * this?" rather than several copies that could disagree.
 */
import { eq } from "drizzle-orm";

import { db } from "@/src/db";
import { organizations, type OrgPlan } from "@/src/db/schema";
/** Both an OpenAI key and a model must be set on the server, or the feature stays hidden as if
 *  the Settings switch were off. */
export function openAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim()) && Boolean(process.env.OPENAI_READ_MODEL?.trim());
}

/** The only place the `"reconciliation_ai"` plan literal is compared for this feature. */
export function readAmountsPlanAllowed(plan: OrgPlan): boolean {
  return plan === "reconciliation_ai";
}

/** The only place the plan, the switch and the server configuration are combined. */
export function canReadAmounts(org: { plan: OrgPlan; readAmountsEnabled: boolean }): boolean {
  return readAmountsPlanAllowed(org.plan) && org.readAmountsEnabled && openAiConfigured();
}

/** Loads the two org fields fresh from the database and applies `canReadAmounts`. Every
 *  surface — new/edit pages, the read route, the tour — calls this rather than keeping its
 *  own copy of the organisation's plan/switch state. */
export async function readAmountsAllowedForOrg(orgId: string): Promise<boolean> {
  const [org] = await db
    .select({ plan: organizations.plan, readAmountsEnabled: organizations.readAmountsEnabled })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return false;
  return canReadAmounts(org);
}
