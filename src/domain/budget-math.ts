/**
 * Budget mathematics (domain-rules §3).
 *
 * The single calculation service: the dashboard, the contract summary screen, the Excel
 * workbook and the packet's summary page all derive their figures here, which is what
 * makes R10.2 ("they always agree") true by construction rather than by discipline.
 *
 * Pure functions over plain shapes — no database types, no IO.
 */
import { compareMonthKeys, type MonthKey } from "./dates";
import { reimbursableCents, type ExpenseComposition } from "./money";

/**
 * The minimum an expense must expose for budget maths.
 *
 * Carries the whole composition, not just the parts that happen to be reimbursable today:
 * which parts count is now per-expense (R1.3), so a query that selects only subtotal and
 * fees would silently compute a different total from the cover sheet.
 */
export type ExpenseAmount = ExpenseComposition & {
  lineItemId: string;
  month: MonthKey;
};

/** The minimum a line item must expose. */
export type LineItemBudget = {
  id: string;
  name: string;
  scheduledValueCents: number;
  openingBilledCents: number;
  sortOrder: number;
};

export type LineItemStats = {
  lineItem: LineItemBudget;
  /** Opening balance from setup + everything billed in earlier months (R3.1). */
  previouslyBilledCents: number;
  /** Reimbursable total for the reporting month (R3.2). */
  spentThisMonthCents: number;
  /** Previously billed + this month (R3.3). */
  totalBilledCents: number;
  /** Scheduled value − total billed; negative when overspent (R3.4). */
  remainingCents: number;
  /** Total billed ÷ scheduled value, as a ratio; 0 when there is no budget (R3.5). */
  percentComplete: number;
  /** Remaining is under 10% of the budget — app screens only, never documents (R3.6). */
  isLowBudget: boolean;
};

/** Threshold at which a line item is flagged as nearly exhausted (R3.6). */
export const LOW_BUDGET_THRESHOLD = 0.1;

/**
 * Figures for one line item in one reporting month.
 *
 * `expenses` may contain the whole organisation's history; rows for other line items and
 * for months after `month` are ignored, so callers can pass one query's worth of rows.
 */
export function lineItemStats(
  lineItem: LineItemBudget,
  expenses: readonly ExpenseAmount[],
  month: MonthKey,
): LineItemStats {
  let earlierCents = 0;
  let spentThisMonthCents = 0;

  for (const expense of expenses) {
    if (expense.lineItemId !== lineItem.id) continue;
    const comparison = compareMonthKeys(expense.month, month);
    if (comparison < 0) earlierCents += reimbursableCents(expense);
    else if (comparison === 0) spentThisMonthCents += reimbursableCents(expense);
    // Months after the reporting month are not billed yet and are excluded.
  }

  const previouslyBilledCents = lineItem.openingBilledCents + earlierCents;
  const totalBilledCents = previouslyBilledCents + spentThisMonthCents;
  const remainingCents = lineItem.scheduledValueCents - totalBilledCents;

  return {
    lineItem,
    previouslyBilledCents,
    spentThisMonthCents,
    totalBilledCents,
    remainingCents,
    percentComplete:
      lineItem.scheduledValueCents === 0 ? 0 : totalBilledCents / lineItem.scheduledValueCents,
    isLowBudget: isLowBudget(remainingCents, lineItem.scheduledValueCents),
  };
}

/**
 * The low-budget warning (R3.6).
 *
 * With no budget to measure against, only an overspend is worth flagging — a ratio would
 * be meaningless and every zero-budget row would light up red.
 */
export function isLowBudget(remainingCents: number, scheduledValueCents: number): boolean {
  if (scheduledValueCents <= 0) return remainingCents < 0;
  return remainingCents / scheduledValueCents < LOW_BUDGET_THRESHOLD;
}

/** Stats for every line item, in the organisation's configured order. */
export function allLineItemStats(
  lineItems: readonly LineItemBudget[],
  expenses: readonly ExpenseAmount[],
  month: MonthKey,
): LineItemStats[] {
  return [...lineItems]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((lineItem) => lineItemStats(lineItem, expenses, month));
}

/**
 * Remaining budget after the expense currently being entered (R3.7).
 *
 * In edit mode the expense's saved amount is already inside `remainingCents`, so it is
 * added back before the live form value is subtracted — otherwise editing an expense
 * would double-count it and show a budget that is too small.
 */
export function projectedRemainingCents(options: {
  remainingCents: number;
  formReimbursableCents: number;
  /** The saved reimbursable amount of the expense being edited, if any. */
  editingExistingCents?: number;
}): number {
  const restored = options.remainingCents + (options.editingExistingCents ?? 0);
  return restored - options.formReimbursableCents;
}
