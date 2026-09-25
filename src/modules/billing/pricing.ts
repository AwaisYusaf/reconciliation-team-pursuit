/**
 * Prices, in cents, as constants (Phase 15 §4.9, C7). Stripe is made to match these, not the
 * other way round: `billing:setup` (Phase 2) creates or moves a Price whenever one of these
 * changes. Read by the landing cards, the in-app chooser, the switch dialog and `billing:setup`
 * — nothing outside this file holds a price literal (U-19).
 */
import type { Interval, PlanId } from "@/src/modules/billing/rules";

export const PRICES_CENTS = {
  reconciliation: { month: 29_700, year: 356_400 }, // yearly: 12 × monthly until changed (O1)
  reconciliation_ai: { month: 49_700, year: 596_400 },
} as const satisfies Record<PlanId, Record<Interval, number>>;

/** The key `billing:setup` tags each Stripe Price with, so no price id is hard-coded. */
export const lookupKey = (plan: PlanId, interval: Interval): string => `${plan}_${interval}`;

export const priceCents = (plan: PlanId, interval: Interval): number => PRICES_CENTS[plan][interval];
