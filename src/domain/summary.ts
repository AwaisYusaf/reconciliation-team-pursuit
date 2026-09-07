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

export type ContractSettingsInput = {
  contractValueCents: number;
  advancesReceivedCents: number;
};

export type SummaryRow = {
  name: string;
  scheduledCents: number;
  /** Just the performance slice of `scheduledCents` (m08) — 0 for a row with none. */
  performanceCents: number;
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
  performanceCents = 0,
): SummaryRow {
  const totalBilledCents = previouslyBilledCents + thisPeriodCents;
  return {
    name,
    scheduledCents,
    performanceCents,
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
      stat.lineItem.performanceCents,
    ),
  );

  const baseSubtotal = row(
    "Base subtotal",
    sumBy(baseRows, (r) => r.scheduledCents),
    sumBy(baseRows, (r) => r.previouslyBilledCents),
    sumBy(baseRows, (r) => r.thisPeriodCents),
    sumBy(baseRows, (r) => r.performanceCents),
  );

  // `totals` always equals `baseSubtotal` now — the performance grant section that used to be
  // added on top is gone (m08 folds performances into each line item's own scheduled value
  // instead, so every line item is already a base row). Kept as its own field anyway: it is
  // the label every screen, the Excel sheet and the PDF render as the single bottom-line row
  // ("Totals", not "Base subtotal" — the external-facing name the City already reads), and the
  // reconciliation block below keys off it.
  const totals = row(
    "Totals",
    baseSubtotal.scheduledCents,
    baseSubtotal.previouslyBilledCents,
    baseSubtotal.thisPeriodCents,
    baseSubtotal.performanceCents,
  );

  const advancesCents = input.settings.advancesReceivedCents;
  const reconciledCents = totals.totalBilledCents;

  return {
    baseRows,
    baseSubtotal,
    totals,
    reconciliation: {
      advancesCents,
      reconciledCents,
      balanceCents: advancesCents - reconciledCents,
      percentReconciled: advancesCents === 0 ? 0 : reconciledCents / advancesCents,
    },
    // A configured contract value is a fixed figure from the signed SOW, independent of the
    // line items' own scheduled totals (R7.3) — but a performance (m08) is real additional
    // budget added after the fact, so it still has to be added on top here, the same way it
    // is already folded into every line item's own `scheduledValueCents`. Unset falls back to
    // `totals.scheduledCents`, which already includes every performance, so nothing to add.
    contractTotalCents:
      input.settings.contractValueCents > 0
        ? input.settings.contractValueCents + totals.performanceCents
        : totals.scheduledCents,
  };
}
