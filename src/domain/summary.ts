/**
 * Contract summary (domain-rules §7).
 *
 * Produces the seven-column table the City already reads, plus the advance-reconciliation
 * block. The m07 screen, Excel sheet 1 and the packet's summary page all render this same
 * structure, so they cannot drift apart.
 */
import { allLineItemStats, type ExpenseAmount, type LineItemBudget } from "./budget-math";
import type { MonthKey } from "./dates";
import { sumBy } from "./money";

/** Fixed label for the performance grant row (R7.2). */
export const PERFORMANCE_GRANT_LABEL = "Performance Grant 1";

export type ContractSettingsInput = {
  contractValueCents: number;
  perfGrantScheduledCents: number;
  perfGrantBilledCents: number;
  advancesReceivedCents: number;
};

export type SummaryRow = {
  name: string;
  scheduledCents: number;
  previouslyBilledCents: number;
  thisPeriodCents: number;
  totalBilledCents: number;
  /** Ratio, not a percentage — formatting happens at the edge (R1.5). */
  percentComplete: number;
  balanceCents: number;
};

export type Reconciliation = {
  advancesCents: number;
  reconciledCents: number;
  balanceCents: number;
  percentReconciled: number;
};

export type ContractSummary = {
  baseRows: SummaryRow[];
  baseSubtotal: SummaryRow;
  performanceRow: SummaryRow;
  totals: SummaryRow;
  reconciliation: Reconciliation;
  /** Configured contract value, or the sum of scheduled values when unset (R7.3). */
  contractTotalCents: number;
};

function row(
  name: string,
  scheduledCents: number,
  previouslyBilledCents: number,
  thisPeriodCents: number,
): SummaryRow {
  const totalBilledCents = previouslyBilledCents + thisPeriodCents;
  return {
    name,
    scheduledCents,
    previouslyBilledCents,
    thisPeriodCents,
    totalBilledCents,
    percentComplete: scheduledCents === 0 ? 0 : totalBilledCents / scheduledCents,
    balanceCents: scheduledCents - totalBilledCents,
  };
}

/** Build the whole summary for one reporting month. */
export function contractSummary(input: {
  lineItems: readonly LineItemBudget[];
  expenses: readonly ExpenseAmount[];
  settings: ContractSettingsInput;
  month: MonthKey;
}): ContractSummary {
  const stats = allLineItemStats(input.lineItems, input.expenses, input.month);

  const baseRows = stats.map((stat) =>
    row(
      stat.lineItem.name,
      stat.lineItem.scheduledValueCents,
      stat.previouslyBilledCents,
      stat.spentThisMonthCents,
    ),
  );

  const baseSubtotal = row(
    "Base subtotal",
    sumBy(baseRows, (r) => r.scheduledCents),
    sumBy(baseRows, (r) => r.previouslyBilledCents),
    sumBy(baseRows, (r) => r.thisPeriodCents),
  );

  // Performance grant billing happens outside this system, so "this period" is always
  // zero and the billed-to-date figure is maintained by hand in Settings (R7.2).
  const performanceRow = row(
    PERFORMANCE_GRANT_LABEL,
    input.settings.perfGrantScheduledCents,
    input.settings.perfGrantBilledCents,
    0,
  );

  const totals = row(
    "Totals",
    baseSubtotal.scheduledCents + performanceRow.scheduledCents,
    baseSubtotal.previouslyBilledCents + performanceRow.previouslyBilledCents,
    baseSubtotal.thisPeriodCents + performanceRow.thisPeriodCents,
  );

  const advancesCents = input.settings.advancesReceivedCents;
  const reconciledCents = totals.totalBilledCents;

  return {
    baseRows,
    baseSubtotal,
    performanceRow,
    totals,
    reconciliation: {
      advancesCents,
      reconciledCents,
      balanceCents: advancesCents - reconciledCents,
      percentReconciled: advancesCents === 0 ? 0 : reconciledCents / advancesCents,
    },
    contractTotalCents:
      input.settings.contractValueCents > 0
        ? input.settings.contractValueCents
        : totals.scheduledCents,
  };
}
