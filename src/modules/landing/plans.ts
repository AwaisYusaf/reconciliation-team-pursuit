/**
 * The two plans the landing page sells, and what each costs a month.
 *
 * The amounts are read from `PRICES_CENTS` (`src/modules/billing/pricing.ts`), the one place a
 * price is written: the same constant Stripe's prices are created from (`billing:setup`) and the
 * in-app chooser prints, so the landing page can never show a price the checkout won't charge.
 * The price used to be typed six times here and in `app/page.tsx`; a price change that missed
 * one would have shown a visitor two prices for the same plan, or told Google a third.
 */
import { PLAN_LABELS } from "@/src/domain/strings";
import { PRICES_CENTS } from "@/src/modules/billing/pricing";
import { planPriceLabel } from "@/src/modules/landing/plan-links";

export const PLANS = {
  reconciliation: { name: PLAN_LABELS.reconciliation, monthlyUsd: PRICES_CENTS.reconciliation.month / 100 },
  reconciliationAi: { name: PLAN_LABELS.reconciliation_ai, monthlyUsd: PRICES_CENTS.reconciliation_ai.month / 100 },
} as const;

export type PlanKey = keyof typeof PLANS;

const CENTS_KEY = { reconciliation: "reconciliation", reconciliationAi: "reconciliation_ai" } as const;

/** The monthly price as the page prints it: whole dollars without cents, any other amount with them (never rounded). */
export function planPrice(plan: PlanKey): string {
  return planPriceLabel(PRICES_CENTS[CENTS_KEY[plan]].month);
}
