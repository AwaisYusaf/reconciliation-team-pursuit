/**
 * What the Settings → Plan & billing section shows, as a pure function of the org's billing
 * columns (Phase 16 §4.3, U-14). No database and no browser, so every state is unit-tested; the
 * server loader (`plan-view-loader.ts`) reads the row and calls this, the client section renders
 * the result.
 */
import type { IsoDate } from "@/src/domain/dates";
import { todayIso } from "@/src/domain/dates";
import { isComplimentaryNow } from "@/src/domain/complimentary";
import { isInterval, isPlanId, type Interval, type PlanId } from "@/src/modules/billing/rules";

/** Admins are warned this many days before complimentary access ends (D4). */
export const COMP_WARNING_DAYS = 14;

export type PlanBillingRow = {
  plan: PlanId;
  complimentary: boolean;
  complimentaryUntil: IsoDate | null;
  complimentaryPlan: PlanId | null;
  stripeStatus: string | null;
  billingInterval: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pendingPlan: PlanId | null;
  pendingInterval: string | null;
  pendingAt: Date | null;
  pendingReason: string | null;
  upgradePayUrl: string | null;
  upgradeExpiresAt: Date | null;
};

export type PaidPlanView = {
  plan: PlanId;
  /** The day it ends when cancelling, else the day it renews. */
  periodEnd: IsoDate | null;
  cancelling: boolean;
  /** Its last payment failed: Stripe refuses a cancel then (`payment_failed`), so none is offered. */
  paymentFailed: boolean;
};

export type PendingChangeView = {
  kind: "downgrade" | "price_move";
  plan: PlanId;
  interval: Interval;
  at: IsoDate;
};

/** Only built while billing is on: until then nothing shows Plan & billing. */
export type PlanBillingView =
  | {
      kind: "complimentaryAccess";
      plan: PlanId;
      until: IsoDate | null;
      endingSoon: boolean;
      /** A paid plan still running beside the free access, or null. Staff granting access to a
       *  paying org choose to cancel it now or at the end of the paid period (§4.6), so this is
       *  usually one that is ending; it renews only if the grant was made while Stripe couldn't
       *  be reached. The admin can still cancel it and open Card and invoices; buying another
       *  plan is refused while it runs. */
      paidPlan: PaidPlanView | null;
    }
  | {
      kind: "subscribed";
      plan: PlanId;
      interval: Interval | null;
      /** Renewal date, or the date access ends when cancelling. */
      periodEnd: IsoDate | null;
      cancelling: boolean;
      /** A payment failed: this wins over every other notice (§4.3). */
      paymentFailed: boolean;
      /** Stripe stopped retrying (`unpaid`) or paused the plan: access is off until the bill is
       *  paid or the plan is ended, so the panel shows on `/r/plan` too. */
      onHold: boolean;
      /** Null whenever `paymentFailed`, since that panel replaces it. */
      pending: PendingChangeView | null;
      /** An upgrade waiting for payment; null once expired or whenever `paymentFailed`. */
      upgrade: { payUrl: string; expiresAt: Date } | null;
    }
  /** No paid plan. `pageSession` keeps an unpaid org off Settings, so this is a safe fallback. */
  | { kind: "none" };

const SUBSCRIBED = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);

function isoDaysBetween(from: IsoDate, to: IsoDate): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function planBillingView(row: PlanBillingRow, ctx: { now: Date }): PlanBillingView {
  const today = todayIso(ctx.now);
  const live = row.stripeStatus !== null && SUBSCRIBED.has(row.stripeStatus);
  const periodEnd = row.currentPeriodEnd ? todayIso(row.currentPeriodEnd) : null;
  if (isComplimentaryNow(row, today)) {
    const until = row.complimentaryUntil;
    return {
      kind: "complimentaryAccess",
      plan: row.complimentaryPlan ?? row.plan,
      until,
      endingSoon: until !== null && isoDaysBetween(today, until) <= COMP_WARNING_DAYS,
      // `plan` is what the live subscription pays for: the sync writes it (P27).
      paidPlan: live
        ? {
            plan: row.plan,
            periodEnd,
            cancelling: row.cancelAtPeriodEnd,
            paymentFailed: row.stripeStatus !== "active" && row.stripeStatus !== "trialing",
          }
        : null,
    };
  }

  if (!live) return { kind: "none" };

  const onHold = row.stripeStatus === "unpaid" || row.stripeStatus === "paused";
  const paymentFailed = row.stripeStatus === "past_due" || onHold;
  const pendingLive =
    !paymentFailed &&
    row.pendingAt !== null &&
    row.pendingAt > ctx.now &&
    row.pendingPlan !== null &&
    isPlanId(row.pendingPlan) &&
    isInterval(row.pendingInterval);
  const upgradeLive =
    !paymentFailed && row.upgradePayUrl !== null && row.upgradeExpiresAt !== null && row.upgradeExpiresAt > ctx.now;

  return {
    kind: "subscribed",
    plan: row.plan,
    interval: isInterval(row.billingInterval) ? row.billingInterval : null,
    periodEnd,
    cancelling: row.cancelAtPeriodEnd,
    paymentFailed,
    onHold,
    pending: pendingLive
      ? {
          kind: row.pendingReason === "price_move" ? "price_move" : "downgrade",
          plan: row.pendingPlan as PlanId,
          interval: row.pendingInterval as Interval,
          at: todayIso(row.pendingAt as Date),
        }
      : null,
    upgrade: upgradeLive ? { payUrl: row.upgradePayUrl as string, expiresAt: row.upgradeExpiresAt as Date } : null,
  };
}

/** "monthly" / "yearly", for sentences like "billed monthly". */
export function intervalAdverb(interval: Interval): string {
  return interval === "month" ? "monthly" : "yearly";
}

/** "month" / "year", for "per month". */
export function intervalNoun(interval: Interval): string {
  return interval;
}
