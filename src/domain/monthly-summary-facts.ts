/**
 * Monthly summary facts (Phase 11, D-107, P2).
 *
 * Pure: no IO, no database types. Every figure here is produced by the same functions the
 * Dashboard and Contract Summary already call (`allLineItemStats`, `grantPosition`,
 * `contractSummary`, `reimbursableCents`, `receiptTotalCents`, `excludedParts`) — never
 * reimplemented — which is what makes "the model's figures match the Dashboard and Contract
 * Summary exactly" (Appendix A §4) true by construction rather than by discipline.
 *
 * Every money value is a `Money` (integer cents for tests, `formatMoney` text for the model and
 * the verifier). The model never adds anything up itself (P2): it only ever sees `.text`.
 */
import {
  allLineItemStats,
  grantPosition,
  type ExpenseAmount,
  type LineItemBudget,
} from "./budget-math";
import { isValidMonthKey, monthLabel, shiftMonth, formatDateShort, type IsoDate, type MonthKey } from "./dates";
import { formatMoney, formatPercent, ratio } from "./format";
import {
  excludedParts,
  reimbursableCents,
  receiptTotalCents,
  type ExpenseComposition,
} from "./money";
import { contractSummary, type ContractSettingsInput } from "./summary";

/** What one expense must expose for the facts, on top of its composition. */
export type SummaryExpense = ExpenseComposition & {
  id: string;
  lineItemId: string;
  name: string;
  description: string;
  narrative: string | null;
  note: string | null;
  date: IsoDate;
  noReceipt: boolean;
  noReceiptReason: string | null;
};

/** Integer cents for tests, formatted text for the model and the verifier — never both loose. */
export type Money = { cents: number; text: string };

/** P16: a free-text field longer than this is cut, so one long narrative can't blow the prompt
 *  budget on its own. */
export const SUMMARY_FIELD_MAX_CHARS = 1000;

/** P18: "noticeably" up or down. */
export const NOTICEABLE_MIN_RATIO = 0.25;
export const NOTICEABLE_MIN_CENTS = 10_000;

export type MonthFacts = {
  header: {
    docName: string;
    sourceName: string;
    monthLabel: string;
    previousMonthLabel: string;
  };
  overview: {
    expenseCount: number;
    totalSpent: Money;
    topLineItems: Array<{ name: string; spent: Money }>;
  };
  spending: Array<{
    name: string;
    spent: Money;
    expenseCount: number;
    payeeCount: number;
    expenses: Array<{
      name: string;
      date: string;
      description: string;
      narrative: string | null;
      note: string | null;
      amount: Money;
    }>;
  }>;
  budget: {
    lineItems: Array<{
      name: string;
      scheduled: Money;
      spentThisMonth: Money;
      spentToDate: Money;
      remaining: Money;
      percentComplete: string;
    }>;
    overall: {
      approved: Money;
      spentToDate: Money;
      remaining: Money;
      percentComplete: string;
      contractTotal: Money;
    };
  };
  changes: {
    previousMonthHadSpending: boolean;
    lineItems: Array<{
      name: string;
      previous: Money;
      current: Money;
      change: Money;
      direction: "up" | "down" | "none";
      changePercent: string | null;
      noticeable: boolean;
    }>;
  };
  itemsToNote: {
    noReceipt: Array<{ name: string; amount: Money; reason: string }>;
    refunds: Array<{ name: string; amount: Money }>;
    notReimbursed: Array<{
      name: string;
      receiptTotal: Money;
      parts: Array<{ part: "tax" | "fees"; amount: Money }>;
    }>;
  };
  /** Sorted unique set of every `.text` amount above, and nothing else (verified by the
   *  verifier — `src/domain/summary-verifier.ts`). */
  allowedAmounts: string[];
  /** Sorted unique set of every percent string above. */
  allowedPercents: string[];
};

function money(cents: number): Money {
  return { cents, text: formatMoney(cents) };
}

/** Array.from, not slice: a surrogate-pair emoji must not be split in half (P16). */
function cutText(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= SUMMARY_FIELD_MAX_CHARS) return text;
  return `${chars.slice(0, SUMMARY_FIELD_MAX_CHARS).join("")}…[cut]`;
}

function noticeable(previousCents: number, currentCents: number): boolean {
  const previousZero = previousCents === 0;
  const currentZero = currentCents === 0;
  if (previousZero !== currentZero) return true; // from nothing to something, or the reverse
  if (previousZero && currentZero) return false;
  const diff = Math.abs(currentCents - previousCents);
  // Whole percent, rounded, so a constant like 0.29 can't become 28.999… in float maths.
  return (
    diff >= NOTICEABLE_MIN_CENTS &&
    diff * 100 >= Math.abs(previousCents) * Math.round(NOTICEABLE_MIN_RATIO * 100)
  );
}

export function buildMonthFacts(input: {
  orgDocName: string;
  source: { name: string; docName: string | null };
  month: MonthKey;
  lineItems: readonly LineItemBudget[];
  /** Live, this source, month <= month. */
  expensesUpToMonth: readonly ExpenseAmount[];
  /** Live, this source, this month, in entry order. */
  monthExpenses: readonly SummaryExpense[];
  settings: ContractSettingsInput;
}): MonthFacts {
  if (!isValidMonthKey(input.month)) throw new Error(`Invalid month key: ${input.month}`);

  const previousMonth = shiftMonth(input.month, -1);
  const stats = allLineItemStats(input.lineItems, input.expensesUpToMonth, input.month);
  const previousStats = allLineItemStats(input.lineItems, input.expensesUpToMonth, previousMonth);
  const grant = grantPosition(stats);
  const summary = contractSummary({
    lineItems: input.lineItems,
    expenses: input.expensesUpToMonth,
    settings: input.settings,
    month: input.month,
  });

  const expensesByLineItem = new Map<string, SummaryExpense[]>();
  for (const expense of input.monthExpenses) {
    const list = expensesByLineItem.get(expense.lineItemId) ?? [];
    list.push(expense);
    expensesByLineItem.set(expense.lineItemId, list);
  }

  // Overview — non-zero spend, sorted desc; Array#sort is stable, so ties keep `stats`' order.
  const topLineItems = stats
    .filter((stat) => stat.spentThisMonthCents !== 0)
    .map((stat) => ({ name: stat.lineItem.name, spent: money(stat.spentThisMonthCents) }))
    .sort((a, b) => b.spent.cents - a.spent.cents);

  const overview = {
    expenseCount: input.monthExpenses.length,
    totalSpent: money(stats.reduce((sum, stat) => sum + stat.spentThisMonthCents, 0)),
    topLineItems,
  };

  // Spending by line item — non-zero spend (negatives included), in line item order. A line item
  // whose expenses net to zero (a charge and its refund) is kept, so its expenses aren't dropped.
  const spending = stats
    .filter((stat) => stat.spentThisMonthCents !== 0 || expensesByLineItem.has(stat.lineItem.id))
    .map((stat) => {
      const lineItemExpenses = expensesByLineItem.get(stat.lineItem.id) ?? [];
      const payees = new Set(lineItemExpenses.map((expense) => expense.name.trim().toLowerCase()));
      return {
        name: stat.lineItem.name,
        spent: money(stat.spentThisMonthCents),
        expenseCount: lineItemExpenses.length,
        payeeCount: payees.size,
        expenses: lineItemExpenses.map((expense) => ({
          name: cutText(expense.name),
          date: formatDateShort(expense.date),
          description: cutText(expense.description),
          narrative: expense.narrative === null ? null : cutText(expense.narrative),
          note: expense.note === null ? null : cutText(expense.note),
          amount: money(reimbursableCents(expense)),
        })),
      };
    });

  // Budget position — every line item, same order as Contract Summary.
  const budget = {
    lineItems: stats.map((stat) => ({
      name: stat.lineItem.name,
      scheduled: money(stat.lineItem.scheduledValueCents),
      spentThisMonth: money(stat.spentThisMonthCents),
      spentToDate: money(stat.totalBilledCents),
      remaining: money(stat.remainingCents),
      percentComplete: formatPercent(stat.percentComplete),
    })),
    overall: {
      approved: money(grant.approvedCents),
      spentToDate: money(grant.spentToDateCents),
      remaining: money(grant.remainingCents),
      percentComplete: formatPercent(grant.percentComplete),
      contractTotal: money(summary.contractTotalCents),
    },
  };

  // Changes from last month — every line item, line item order; `stats`/`previousStats` share
  // the same `input.lineItems` order, so they can be zipped by index.
  const changes = {
    previousMonthHadSpending: previousStats.some((stat) => stat.spentThisMonthCents !== 0),
    lineItems: stats.map((stat, index) => {
      const previousCents = previousStats[index].spentThisMonthCents;
      const currentCents = stat.spentThisMonthCents;
      const diff = currentCents - previousCents;
      return {
        name: stat.lineItem.name,
        previous: money(previousCents),
        current: money(currentCents),
        change: money(Math.abs(diff)),
        direction: (diff > 0 ? "up" : diff < 0 ? "down" : "none") as "up" | "down" | "none",
        changePercent:
          previousCents === 0 ? null : formatPercent(ratio(Math.abs(diff), Math.abs(previousCents))),
        noticeable: noticeable(previousCents, currentCents),
      };
    }),
  };

  // Items to note.
  const itemsToNote = {
    noReceipt: input.monthExpenses
      .filter((expense) => expense.noReceipt)
      .map((expense) => ({
        name: cutText(expense.name),
        amount: money(reimbursableCents(expense)),
        reason: cutText(expense.noReceiptReason ?? ""),
      })),
    refunds: input.monthExpenses
      .filter((expense) => reimbursableCents(expense) < 0)
      .map((expense) => ({ name: cutText(expense.name), amount: money(reimbursableCents(expense)) })),
    notReimbursed: input.monthExpenses
      .map((expense) => ({ expense, excluded: excludedParts(expense) }))
      .filter(({ excluded }) => excluded.length > 0)
      .map(({ expense, excluded }) => ({
        name: cutText(expense.name),
        receiptTotal: money(receiptTotalCents(expense)),
        parts: excluded.map((part) => ({
          part,
          amount: money(part === "tax" ? expense.taxCents : expense.feesCents),
        })),
      })),
  };

  const allowedAmounts = new Set<string>();
  const allowedPercents = new Set<string>();
  allowedAmounts.add(overview.totalSpent.text);
  for (const item of topLineItems) allowedAmounts.add(item.spent.text);
  for (const row of spending) {
    allowedAmounts.add(row.spent.text);
    for (const expense of row.expenses) allowedAmounts.add(expense.amount.text);
  }
  for (const row of budget.lineItems) {
    allowedAmounts.add(row.scheduled.text);
    allowedAmounts.add(row.spentThisMonth.text);
    allowedAmounts.add(row.spentToDate.text);
    allowedAmounts.add(row.remaining.text);
    allowedPercents.add(row.percentComplete);
  }
  allowedAmounts.add(budget.overall.approved.text);
  allowedAmounts.add(budget.overall.spentToDate.text);
  allowedAmounts.add(budget.overall.remaining.text);
  allowedAmounts.add(budget.overall.contractTotal.text);
  allowedPercents.add(budget.overall.percentComplete);
  for (const row of changes.lineItems) {
    allowedAmounts.add(row.previous.text);
    allowedAmounts.add(row.current.text);
    allowedAmounts.add(row.change.text);
    if (row.changePercent !== null) allowedPercents.add(row.changePercent);
  }
  for (const row of itemsToNote.noReceipt) allowedAmounts.add(row.amount.text);
  for (const row of itemsToNote.refunds) allowedAmounts.add(row.amount.text);
  for (const row of itemsToNote.notReimbursed) {
    allowedAmounts.add(row.receiptTotal.text);
    for (const part of row.parts) allowedAmounts.add(part.amount.text);
  }

  return {
    header: {
      docName: input.source.docName ?? input.orgDocName,
      sourceName: input.source.name,
      monthLabel: monthLabel(input.month),
      previousMonthLabel: monthLabel(previousMonth),
    },
    overview,
    spending,
    budget,
    changes,
    itemsToNote,
    allowedAmounts: [...allowedAmounts].sort(),
    allowedPercents: [...allowedPercents].sort(),
  };
}

/** Deep-strips every `Money` down to its `.text` — the model must never see raw cents. */
function stripCents(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCents);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.length === 2 &&
      typeof record.cents === "number" &&
      typeof record.text === "string"
    ) {
      return record.text;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) out[key] = stripCents(entry);
    return out;
  }
  return value;
}

/** P16: the request budget. Facts (with expense detail) rarely approach this for a real month;
 *  a 300-expense month with long narratives is what it exists for. */
export const SUMMARY_FACTS_MAX_CHARS = 120_000;

/**
 * Facts as the model sees them: every `Money` reduced to its formatted text, `allowedAmounts`/
 * `allowedPercents` left out entirely (the verifier's answer key, never the model's input).
 *
 * Falls back to per-line-item facts only (no expense detail) when the full payload would exceed
 * `maxChars` (P16). If even that is still over the limit — a ponytail ceiling this app does not
 * try to push past — it is returned anyway, flagged, rather than silently truncated further;
 * upgrade to trimming line items themselves if a real month ever hits this.
 */
export function serializeFactsForPrompt(
  facts: MonthFacts,
  maxChars = SUMMARY_FACTS_MAX_CHARS,
): { text: string; expenseDetailDropped: boolean } {
  const rest = {
    header: facts.header,
    overview: facts.overview,
    spending: facts.spending,
    budget: facts.budget,
    changes: facts.changes,
    itemsToNote: facts.itemsToNote,
  };

  const full = JSON.stringify(stripCents(rest));
  if (full.length <= maxChars) return { text: full, expenseDetailDropped: false };

  const trimmed = {
    ...rest,
    spending: rest.spending.map((row) => ({ ...row, expenses: [] })),
  };
  return { text: JSON.stringify(stripCents(trimmed)), expenseDetailDropped: true };
}
