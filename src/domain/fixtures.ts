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

/**
 * Scheduled values and opening balances, in cents.
 *
 * "Performance Grant 1" is here as an ordinary line item, not a separate section: the old
 * Settings-based performance grant (once its own row, added onto `baseSubtotal` to make
 * `totals`) is retired in favor of per-line-item performances (m08), which fold into
 * `scheduledValueCents` before it ever reaches this fixture shape. Modeling it as a plain
 * 7th line item — same $175,000.00 scheduled / $39,229.50 opening billed the approved packet
 * published — is what keeps this fixture reproducing that packet's exact figures.
 */
// `performanceCents: 0` throughout — this fixture is the published packet's golden reference,
// which predates the base/performance split (m08) and never had one to show.
export const LINE_ITEMS: LineItemBudget[] = [
  { id: "salary", name: "Salary", scheduledValueCents: 45869246, performanceCents: 0, openingBilledCents: 35000000, sortOrder: 0 },
  { id: "analytical", name: "Analytical Support", scheduledValueCents: 6692914, performanceCents: 0, openingBilledCents: 4000000, sortOrder: 1 },
  { id: "promo", name: "Promotional & Marketing", scheduledValueCents: 5821262, performanceCents: 0, openingBilledCents: 4819851, sortOrder: 2 },
  { id: "social", name: "Social Services & Support", scheduledValueCents: 4125000, performanceCents: 0, openingBilledCents: 3000000, sortOrder: 3 },
  { id: "community", name: "Community Programs & Events", scheduledValueCents: 3983245, performanceCents: 0, openingBilledCents: 1398596, sortOrder: 4 },
  { id: "profdev", name: "Professional Development", scheduledValueCents: 1500000, performanceCents: 0, openingBilledCents: 174900, sortOrder: 5 },
  { id: "perfgrant1", name: "Performance Grant 1", scheduledValueCents: 17500000, performanceCents: 0, openingBilledCents: 3922950, sortOrder: 6 },
];

/**
 * One expense per line item for February, summing to each published "This Period" figure.
 *
 * Flags set to the original rule (tax excluded, fees included) so these keep reproducing the
 * approved February packet exactly — that is what makes them a golden reference (R1.3).
 */
/**
 * The original reimbursement rule — tax excluded, fees included (R1.3) — which is what these
 * fixtures must keep reproducing to stay a golden reference for the approved February packet.
 */
function febAmount(lineItemId: string, subtotalCents: number): ExpenseAmount {
  return {
    lineItemId,
    month: FEB,
    subtotalCents,
    taxCents: 0,
    feesCents: 0,
    taxReimbursable: false,
    feesReimbursable: true,
  };
}

export const FEB_EXPENSES: ExpenseAmount[] = [
  febAmount("salary", 4564112),
  febAmount("analytical", 1989083),
  febAmount("promo", 1185165),
  febAmount("social", 1023108),
  febAmount("community", 425128),
  febAmount("profdev", 159900),
];

export const SETTINGS: ContractSettingsInput = {
  contractValueCents: 94000000,
  advancesReceivedCents: 66500000,
};
