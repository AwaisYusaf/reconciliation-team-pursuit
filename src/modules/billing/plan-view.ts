/**
 * What the Settings → Plan & billing section shows, as a pure function of the org's billing
 * columns (Phase 15 §4.3, U-14). No database and no browser, so every state is unit-tested; the
 * server loader (`plan-view-loader.ts`) reads the row and calls this, the client section renders
 * the result.
 */
import type { IsoDate } from "@/src/domain/dates";
import { todayIso } from "@/src/domain/dates";
import { isComplimentaryNow } from "@/src/domain/complimentary";
import { complimentaryStart, isInterval, isPlanId, type Interval, type PlanId } from "@/src/modules/billing/rules";

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

export type PendingChangeView = {
  kind: "downgrade" | "price_move";
  plan: PlanId;
  interval: Interval;
  at: IsoDate;
};

export type PlanBillingView =
  /** `BILLING_ENABLED` is off: nothing to manage yet. */
  | { kind: "off" }
  | {
      kind: "complimentaryAccess";
      plan: PlanId;
      until: IsoDate | null;
      endingSoon: boolean;
      /** Buying now: the first charge waits for the free access to run out, or is today. */
      buy: { kind: "defer"; firstChargeOn: IsoDate } | { kind: "now" };
      /** A plan already bought during the free access, starting when it runs out. */
      upcoming: { plan: PlanId; interval: Interval | null; startsOn: IsoDate | null; cancelling: boolean } | null;
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
      /** Null whenever `paymentFailed`, since that panel replaces it. */
      pending: PendingChangeView | null;
      /** An upgrade waiting for payment; null once expired or whenever `paymentFailed`. */
      upgrade: { payUrl: string; expiresAt: Date } | null;
    }
  /** No paid plan. `pageSession` keeps an unpaid org off Settings, so this is a safe fallback. */
  | { kind: "none" };

const SUBSCRIBED = new Set(["active", "trialing", "past_due", "unpaid"]);

function isoDaysBetween(from: IsoDate, to: IsoDate): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function planBillingView(row: PlanBillingRow, ctx: { billingOn: boolean; now: Date }): PlanBillingView {
  if (!ctx.billingOn) return { kind: "off" };

  const today = todayIso(ctx.now);
  if (isComplimentaryNow(row, today)) {
    const until = row.complimentaryUntil;
    const start = complimentaryStart(until, ctx.now);
    const bought = row.stripeStatus === "trialing" || row.stripeStatus === "active";
    return {
      kind: "complimentaryAccess",
      plan: row.complimentaryPlan ?? row.plan,
      until,
      endingSoon: until !== null && isoDaysBetween(today, until) <= COMP_WARNING_DAYS,
      buy: start.kind === "defer" ? { kind: "defer", firstChargeOn: todayIso(start.firstChargeAt) } : { kind: "now" },
      upcoming: bought
        ? {
            plan: row.plan,
            interval: isInterval(row.billingInterval) ? row.billingInterval : null,
            startsOn: row.currentPeriodEnd ? todayIso(row.currentPeriodEnd) : null,
            cancelling: row.cancelAtPeriodEnd,
          }
        : null,
    };
  }

  if (!row.stripeStatus || !SUBSCRIBED.has(row.stripeStatus)) return { kind: "none" };

  const paymentFailed = row.stripeStatus === "past_due" || row.stripeStatus === "unpaid";
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
    periodEnd: row.currentPeriodEnd ? todayIso(row.currentPeriodEnd) : null,
    cancelling: row.cancelAtPeriodEnd,
    paymentFailed,
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
