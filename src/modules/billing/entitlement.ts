/**
 * `orgEntitlement` (Phase 16, P9): the one access function every AI gate, the paywall, the
 * funding-source limit, shared links and the header pill read (U-20 checks nothing else reads
 * `stripe_status`/`complimentary`/`subscription_status` to decide access). Pure, no `db` import
 * — `resolveSession` (a later phase) loads the row and calls this once per request.
 *
 * Suspension is handled earlier, in `resolveSession`, and is not part of this function (§4.2).
 */
import { complimentaryState, isComplimentaryNow } from "@/src/domain/complimentary";
import { todayIso, type IsoDate } from "@/src/domain/dates";
import { fundingSourceLimit, KNOWN_STRIPE_STATUSES, PAID_STATUSES, type PlanId } from "@/src/modules/billing/rules";

export type Entitlement =
  | { paid: true; plan: PlanId; reason: "billing_off" | "complimentary" | "subscription" }
  | { paid: false; plan: PlanId; reason: "new" | "ended" | "complimentary_ended" | "unknown_status" };

export type EntitlementOrg = {
  plan: PlanId;
  complimentary: boolean;
  complimentaryUntil: IsoDate | null;
  complimentaryPlan: PlanId | null;
  stripeStatus: string | null;
};

/**
 * `enabled` is `billingEnabled()` — passed in rather than read here so this stays pure and
 * unit-testable with both settings (U-4, U-21).
 */
export function orgEntitlement(org: EntitlementOrg, today: IsoDate, enabled: boolean): Entitlement {
  if (!enabled) return { paid: true, plan: org.plan, reason: "billing_off" };

  if (isComplimentaryNow(org, today)) {
    return { paid: true, plan: org.complimentaryPlan ?? org.plan, reason: "complimentary" };
  }

  if (org.stripeStatus !== null && PAID_STATUSES.has(org.stripeStatus)) {
    return { paid: true, plan: org.plan, reason: "subscription" };
  }

  if (complimentaryState(org, today) === "ended") {
    return { paid: false, plan: org.plan, reason: "complimentary_ended" };
  }
  if (org.stripeStatus === null || org.stripeStatus === "incomplete" || org.stripeStatus === "incomplete_expired") {
    // Never had a paid subscription (a new sign-up, or one that only ever abandoned Checkout).
    return { paid: false, plan: org.plan, reason: "new" };
  }
  if (!(KNOWN_STRIPE_STATUSES as readonly string[]).includes(org.stripeStatus)) {
    // A future Stripe status this build doesn't know about yet (P8). Callers log ALERT in a
    // later phase; here it is simply not paid.
    return { paid: false, plan: org.plan, reason: "unknown_status" };
  }
  return { paid: false, plan: org.plan, reason: "ended" };
}

/** `null` = unlimited. Billing off never limits (today's behaviour, P25). */
export function activeFundingSourceLimit(ent: Entitlement): number | null {
  if (ent.reason === "billing_off") return null;
  return fundingSourceLimit(ent.plan);
}

export type UpcomingPlanOrg = {
  pendingPlan: PlanId | null;
  pendingReason: string | null;
  pendingAt: Date | null;
};

/**
 * The day a downgrade to Reconciliation queued in the Stripe copy (`pending_*`) starts, or
 * `null` (P24). Adding or unarchiving a funding source is refused while it waits, so the org
 * can't arrive on Reconciliation with several active sources. A plan bought during complimentary
 * access is not a case here: it starts the day it is paid for (D-128).
 */
export function reconciliationStartsOn(org: UpcomingPlanOrg, now: Date): IsoDate | null {
  if (
    org.pendingPlan === "reconciliation" &&
    org.pendingReason === "downgrade" &&
    org.pendingAt !== null &&
    org.pendingAt > now
  ) {
    return todayIso(org.pendingAt);
  }
  return null;
}
