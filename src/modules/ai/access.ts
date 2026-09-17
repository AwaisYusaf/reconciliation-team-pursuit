import "server-only";

/**
 * Access gates for every AI feature (Phase 10, D-105; Phase 11, D-107).
 *
 * `canReadAmounts` is the one place the plan, the Settings switch and the server's OpenAI
 * configuration are combined for receipt reading — every consumer (Add/Edit pages, the read
 * route, the tour) calls `readAmountsAllowedForOrg`, so there is exactly one answer to "is this
 * org allowed to use this?" rather than several copies that could disagree.
 *
 * `canUseSummaries`/`canWriteSummaries` are the same idea for monthly summaries, sharing
 * `aiPlanAllowed` with `canReadAmounts` so the `"reconciliation_ai"` plan literal exists once —
 * but deliberately not sharing `readAmountsEnabled` or `OPENAI_READ_MODEL`, so switching receipt
 * reading off can't silently turn summaries off too.
 */
import { eq } from "drizzle-orm";

import { db } from "@/src/db";
import { organizations, type OrgPlan } from "@/src/db/schema";
/** Both an OpenAI key and a model must be set on the server, or the feature stays hidden as if
 *  the Settings switch were off. */
export function openAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim()) && Boolean(process.env.OPENAI_READ_MODEL?.trim());
}

/** The only place the `"reconciliation_ai"` plan literal is compared, for every AI feature. */
export function aiPlanAllowed(plan: OrgPlan): boolean {
  return plan === "reconciliation_ai";
}

/** The only place the plan, the switch and the server configuration are combined. */
export function canReadAmounts(org: { plan: OrgPlan; readAmountsEnabled: boolean }): boolean {
  return aiPlanAllowed(org.plan) && org.readAmountsEnabled && openAiConfigured();
}

/** Monthly summaries (Phase 11, D-107): open the screen, edit, copy, download — plan only,
 *  never the receipt-reading switch (P1). */
export function canUseSummaries(org: { plan: OrgPlan }): boolean {
  return aiPlanAllowed(org.plan);
}

/** Write draft summary / Write again — plan, plus the server having its own key and model set.
 *  Deliberately not `readAmountsEnabled` or `OPENAI_READ_MODEL`: turning receipt reading off
 *  must not silently turn summaries off too (P1). */
export function canWriteSummaries(org: { plan: OrgPlan }): boolean {
  return (
    aiPlanAllowed(org.plan) &&
    Boolean(process.env.OPENAI_API_KEY?.trim()) &&
    Boolean(process.env.OPENAI_SUMMARY_MODEL?.trim())
  );
}

/** Loads the org's plan fresh from the database and applies `canUseSummaries`/`canWriteSummaries`.
 *  Missing org → both false. */
export async function summariesAccessForOrg(
  orgId: string,
): Promise<{ use: boolean; write: boolean }> {
  const [org] = await db
    .select({ plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return { use: false, write: false };
  return { use: canUseSummaries(org), write: canWriteSummaries(org) };
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
