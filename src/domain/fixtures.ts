/**
 * Shared test fixture: the February 2026 figures from the approved packet.
 *
 * Using the real numbers means the domain tests double as a conformance check against
 * docs/03-modules/m07 — if a calculation drifts, the published figures stop reproducing.
 * Contains no client PII: line item names and contract totals only.
 */
import type { ExpenseAmount, LineItemBudget } from "./budget-math";
import type { ContractSettingsInput } from "./summary";

export const FEB = "2026-02";
export const JAN = "2026-01";
export const MAR = "2026-03";

/** Scheduled values and opening balances, in cents. */
export const LINE_ITEMS: LineItemBudget[] = [
  { id: "salary", name: "Salary", scheduledValueCents: 45869246, openingBilledCents: 35000000, sortOrder: 0 },
  { id: "analytical", name: "Analytical Support", scheduledValueCents: 6692914, openingBilledCents: 4000000, sortOrder: 1 },
  { id: "promo", name: "Promotional & Marketing", scheduledValueCents: 5821262, openingBilledCents: 4819851, sortOrder: 2 },
  { id: "social", name: "Social Services & Support", scheduledValueCents: 4125000, openingBilledCents: 3000000, sortOrder: 3 },
  { id: "community", name: "Community Programs & Events", scheduledValueCents: 3983245, openingBilledCents: 1398596, sortOrder: 4 },
  { id: "profdev", name: "Professional Development", scheduledValueCents: 1500000, openingBilledCents: 174900, sortOrder: 5 },
];

/** One expense per line item for February, summing to each published "This Period" figure. */
export const FEB_EXPENSES: ExpenseAmount[] = [
  { lineItemId: "salary", month: FEB, subtotalCents: 4564112, feesCents: 0 },
  { lineItemId: "analytical", month: FEB, subtotalCents: 1989083, feesCents: 0 },
  { lineItemId: "promo", month: FEB, subtotalCents: 1185165, feesCents: 0 },
  { lineItemId: "social", month: FEB, subtotalCents: 1023108, feesCents: 0 },
  { lineItemId: "community", month: FEB, subtotalCents: 425128, feesCents: 0 },
  { lineItemId: "profdev", month: FEB, subtotalCents: 159900, feesCents: 0 },
];

export const SETTINGS: ContractSettingsInput = {
  contractValueCents: 94000000,
  perfGrantScheduledCents: 17500000,
  perfGrantBilledCents: 3922950,
  advancesReceivedCents: 66500000,
};
