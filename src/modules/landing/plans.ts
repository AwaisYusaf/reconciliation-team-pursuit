/**
 * The two plans the landing page sells, and what each costs a month.
 *
 * The one place a price is written. It used to be typed six times: twice in the pricing
 * cards, once in the AI section, twice inside an FAQ answer, and again in the structured data
 * search engines read (`app/page.tsx`). A price change that missed one of them would have shown
 * a visitor two different prices for the same plan, or told Google a third.
 */
export const PLANS = {
  reconciliation: { name: "Reconciliation", monthlyUsd: 297 },
  reconciliationAi: { name: "Reconciliation + AI", monthlyUsd: 497 },
} as const;

export type PlanKey = keyof typeof PLANS;

/** "$297": whole dollars, which is how every plan is priced. */
export function planPrice(plan: PlanKey): string {
  return `$${PLANS[plan].monthlyUsd}`;
}
