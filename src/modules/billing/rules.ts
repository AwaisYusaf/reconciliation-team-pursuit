/**
 * Every pure billing rule (Phase 16, ported from the reference build's `lib/plans.ts`, P1 to
 * P9). No I/O, no `server-only` — unit-tested directly, and safe to import from a client
 * component if a future phase needs to. Plan names live in `PLAN_LABELS`
 * (`src/domain/strings.ts`), prices in `src/modules/billing/pricing.ts`; this file has neither.
 */
import type { AiUsageFeature, OrgPlan } from "@/src/db/schema";
import { orgPlan } from "@/src/db/schema";

export const INTERVALS = ["month", "year"] as const;
export type Interval = (typeof INTERVALS)[number];
export const isInterval = (v: unknown): v is Interval => INTERVALS.includes(v as Interval);

export type PlanId = OrgPlan;

const INTERVAL_RANK: Record<Interval, number> = { month: 1, year: 2 };

/** Ranked so `classifyChange` can compare "better" without naming every combination by hand. */
const PLAN_RANK: Record<PlanId, number> = { reconciliation: 1, reconciliation_ai: 2 };

/**
 * The AI features each plan unlocks (`ai_usage_feature` in `src/db/schema.ts`,
 * `src/modules/ai/access.ts`). Reconciliation gets none; Reconciliation + AI gets all three.
 */
const PLAN_FEATURES: Record<PlanId, readonly AiUsageFeature[]> = {
  reconciliation: [],
  reconciliation_ai: ["amount_read", "monthly_summary", "invoice_read"],
};

/** One active funding source on Reconciliation (C8); unlimited (`null`) on Reconciliation + AI. */
const FUNDING_SOURCE_LIMIT: Record<PlanId, number | null> = {
  reconciliation: 1,
  reconciliation_ai: null,
};

export const isPlanId = (v: unknown): v is PlanId =>
  typeof v === "string" && Object.hasOwn(PLAN_FEATURES, v) && (orgPlan.enumValues as readonly string[]).includes(v);

export function planIncludes(plan: PlanId, feature: AiUsageFeature): boolean {
  return PLAN_FEATURES[plan].includes(feature);
}

export function fundingSourceLimit(plan: PlanId): number | null {
  return FUNDING_SOURCE_LIMIT[plan];
}

// ── Which subscription counts ────────────────────────────────────────────────

/** The full set of statuses a Stripe subscription can have (U-7, U-9: an unknown one is logged
 *  ALERT rather than crashing a write). */
export const KNOWN_STRIPE_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;
export type StripeStatus = (typeof KNOWN_STRIPE_STATUSES)[number];

/** Statuses that unlock the plan's features (P9's step 4; `entitlement.ts` is the only reader). */
export const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Statuses where a subscription is still "the one" and a second Checkout must be refused.
 *  "incomplete" is deliberately absent: it is an abandoned first payment that Stripe expires in
 *  23h, and it must not stop the customer from simply trying again. */
const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);

export const isLive = (status: string | null) => status !== null && LIVE_STATUSES.has(status);

/**
 * A customer can own several subscriptions over time (cancel, subscribe again later, an
 * abandoned checkout). The current one is the newest live one; failing that, the newest of any
 * status (P1: a late event about an old cancelled subscription never beats the new live one).
 */
export function pickCurrent<T extends { status: string; created: number }>(
  subs: readonly T[],
): T | undefined {
  const newest = [...subs].sort((a, b) => b.created - a.created);
  return newest.find((s) => LIVE_STATUSES.has(s.status)) ?? newest[0];
}

// ── Plan changes ─────────────────────────────────────────────────────────────

export type Change =
  | "none" // same plan and interval
  | "now" // gives more: charge the prorated difference today, switch only if it's paid
  | "at_period_end"; // gives less on either axis: keep what's paid for, switch when the period ends

/**
 * The single rule for every switch (C3, decision 2026-09-25): a change that gives more (better
 * plan, or monthly to yearly) happens now and is paid now; a change that gives less on EITHER
 * axis (lower plan, or yearly to monthly) waits for the period end. Mixed cases (basic yearly to
 * AI monthly) shorten the billing, so they wait.
 */
export function classifyChange(
  from: { plan: PlanId; interval: Interval },
  to: { plan: PlanId; interval: Interval },
): Change {
  const plan = Math.sign(PLAN_RANK[to.plan] - PLAN_RANK[from.plan]);
  const interval = Math.sign(INTERVAL_RANK[to.interval] - INTERVAL_RANK[from.interval]);
  if (plan === 0 && interval === 0) return "none";
  if (plan < 0 || interval < 0) return "at_period_end";
  return "now";
}

/** Which switches a subscription in this state may make. One place, so UI and server agree. */
export function changeBlockedReason(sub: {
  status: string | null;
  cancel_at_period_end: number | boolean;
}): "no_plan" | "payment_failed" | "cancel_pending" | null {
  if (sub.status !== "active" && sub.status !== "trialing") {
    return sub.status === "past_due" || sub.status === "unpaid" ? "payment_failed" : "no_plan";
  }
  if (sub.cancel_at_period_end) return "cancel_pending";
  return null;
}

// ── Buying a plan while complimentary (D-128, 2026-09-28) ────────────────────

/**
 * Subscription metadata: end complimentary access once this subscription's payment succeeds.
 * Buying a plan always ends complimentary access (D-128): the customer's admin decided to pay,
 * so they pay today and the free access stops once that payment goes through, however much of
 * it was left. There is no deferred first charge.
 */
export const END_COMPLIMENTARY_KEY = "endComplimentary";
