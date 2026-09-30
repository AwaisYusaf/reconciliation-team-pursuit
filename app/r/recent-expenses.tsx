import Link from "next/link";

import { Card, EmptyState, SectionTitle } from "@/src/components/ui/surfaces";
import { formatDateUS, monthLabel, type MonthKey } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { documentationStatus } from "@/src/domain/gate";
import { reimbursableCents } from "@/src/domain/money";
import type { ExpenseDetail } from "@/src/modules/expenses/queries";

/** How many rows the panel shows before deferring to the Expenses tab. */
const SHOWN = 5;

/**
 * The month's most recent expenses, as a quick read on what has been entered lately.
 *
 * Every field here is one the expense actually carries: name, line item, date, reimbursable
 * amount, and whether it still needs documents. There is deliberately no status and no
 * payment-card detail — an expense has neither, so showing them would mean inventing them.
 *
 * The missing-documents flag comes from `documentationStatus`, the same judgement the
 * expenses list and the packet's blocking gate use (R4.3, R4.4), so a row flagged here is
 * exactly a row flagged there.
 */
export function RecentExpenses({
  expenses,
  month,
}: {
  expenses: readonly ExpenseDetail[];
  month: MonthKey;
}) {
  // `loadMonthExpenses` returns entry order; most recent first is the tail reversed.
  const recent = expenses.slice(-SHOWN).reverse();

  // The card's `min-w-0` below is load-bearing, not tidiness. A grid item's default
  // `min-width: auto` sizes it to its content rather than to its track, so a row that refuses
  // to shrink widens the whole column and then the page: on a 390px phone this card measured
  // 483px and gave the document a horizontal scrollbar. Capping it is what lets the rows'
  // long names and line-item lines wrap inside the card instead (they used to be cut off with
  // an ellipsis, usability #53).

  return (
    <Card className="p-4 sm:p-5 flex flex-col min-w-0">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <SectionTitle>Recent expenses</SectionTitle>
        <Link
          href="/r/expenses"
          className="text-[15px] text-accent underline hover:text-accent-dark shrink-0"
        >
          View all
        </Link>
      </div>

      {recent.length === 0 ? (
        <EmptyState className="py-8">
          No expenses recorded for {monthLabel(month)} yet.
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5 m-0 p-0 list-none">
            {recent.map((expense) => {
              const { missing } = documentationStatus({
                id: expense.id,
                name: expense.name,
                lineItemName: expense.lineItemName,
                noReceipt: expense.noReceipt,
                hasNarrative: Boolean(expense.narrative?.trim()),
                documents: expense.documents,
              });

              return (
                <li
                  key={expense.id}
                  className="flex items-center gap-3 rounded-[8px] bg-section/60 px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-[15px] text-ink break-words">
                      {expense.name}
                    </span>
                    <span className="block text-[13px] text-sub break-words">
                      {expense.lineItemName} · {formatDateUS(expense.date)}
                    </span>
                  </span>

                  {missing && (
                    <span className="shrink-0 text-[11px] uppercase tracking-[0.06em] font-bold text-danger bg-danger-bg rounded-full px-2 py-1">
                      Incomplete
                    </span>
                  )}

                  <span className="shrink-0 tabular-nums font-bold text-[15px] text-ink">
                    {formatMoney(reimbursableCents(expense))}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="text-[13px] text-sub mt-3 mb-0">
            {recent.length === expenses.length
              ? `${expenses.length} ${expenses.length === 1 ? "expense" : "expenses"} in ${monthLabel(month)}.`
              : `Showing ${recent.length} of ${expenses.length} expenses in ${monthLabel(month)}.`}
          </p>
        </>
      )}
    </Card>
  );
}
