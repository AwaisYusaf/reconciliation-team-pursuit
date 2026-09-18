import { and, eq, isNotNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { db } from "@/src/db";
import { loadSelectableMonths } from "@/src/db/months";
import { loadExpenseAmounts, loadLineItemBudgets } from "@/src/db/queries";
import { monthStatuses } from "@/src/db/schema";
import { allLineItemStats } from "@/src/domain/budget-math";
import { formatDateUS, todayIso } from "@/src/domain/dates";
import { reimbursableCents } from "@/src/domain/money";
import { pageTitle } from "@/src/domain/strings";
import { readAmountsAllowedForOrg } from "@/src/modules/ai/access";
import { ExpenseForm } from "@/src/modules/expenses/expense-form";
import { loadExpense, loadExpenseFormOptions } from "@/src/modules/expenses/queries";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadLockedMonths } from "@/src/modules/packet/queries";
import { getSession } from "@/src/services/auth/session";

export const metadata = { title: pageTitle("Edit Expense") };

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const expense = await loadExpense(session.orgId, id);
  // Org-scoped lookup: another organisation's id is simply not found.
  if (!expense) notFound();

  // Scoped to the expense's OWN source, not the header selection: an expense on a
  // non-selected (or archived) source must still be editable (§6).
  const fundingSourceId = expense.fundingSourceId;

  // The header's *current* selection — separate from the expense's own source above — so the
  // form can tell after saving whether it needs to follow the header there (review fix).
  const { selectedId: headerSelectedSourceId } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );

  const [options, months, submittedRows, lockedMonthKeys, readAmounts] = await Promise.all([
    loadExpenseFormOptions(session.orgId, fundingSourceId),
    // The same list the header offers: a month you can view must be one you can move into.
    loadSelectableMonths(session.orgId, fundingSourceId, [expense.month, session.activeMonth]),
    // Every source's submitted months, not just this expense's own — the warning must cover
    // both the old and the new source once the user changes it (§4, R10.6).
    db
      .select({
        fundingSourceId: monthStatuses.fundingSourceId,
        month: monthStatuses.month,
        submittedAt: monthStatuses.submittedAt,
      })
      .from(monthStatuses)
      .where(and(eq(monthStatuses.orgId, session.orgId), isNotNull(monthStatuses.submittedAt))),
    // Every source, not just this expense's own — the Month dropdown can move it to another
    // source's locked month too (Appendix A §2, D-96).
    loadLockedMonths(session.orgId, null),
    readAmountsAllowedForOrg(session.orgId),
  ]);

  // The Month dropdown moves the expense (R2.2), so both the budget projection and the
  // submitted-month warning have to describe the month currently *selected* — not the one
  // the expense happens to sit in now. Both were resolved for the source month alone, which
  // meant moving into a submitted month warned about nothing and the R3.7 projection quietly
  // described the wrong month's budget.
  //
  // Line item ids are UUIDs and unique across sources, so every source's figures — run once
  // per source in `options.fundingSources` — merge into one flat map per month, keeping the
  // projection and the line item labels correct after the user changes the funding source.
  const remainingByMonth: Record<string, Record<string, number>> = Object.fromEntries(
    months.map((month) => [month, {}]),
  );
  await Promise.all(
    options.fundingSources.map(async (source) => {
      const [lineItems, amounts] = await Promise.all([
        loadLineItemBudgets(session.orgId, source.id),
        loadExpenseAmounts(session.orgId, source.id, months[0] ?? expense.month),
      ]);
      for (const month of months) {
        for (const row of allLineItemStats(lineItems, amounts, month)) {
          remainingByMonth[month][row.lineItem.id] = row.remainingCents;
        }
      }
    }),
  );
  const remaining = remainingByMonth[expense.month] ?? {};

  const submittedOn = Object.fromEntries(
    submittedRows
      .filter((row) => row.submittedAt)
      .map((row) => [
        `${row.fundingSourceId}:${row.month}`,
        formatDateUS(todayIso(row.submittedAt!)),
      ]),
  );

  const toMoney = (cents: number) => (cents / 100).toFixed(2);

  return (
    <div>
      <PageTitle className="mb-2">Edit Expense</PageTitle>
      <Subtext className="mb-[30px] max-w-[60ch]">{expense.name}</Subtext>

      <ExpenseForm
        options={{ ...options, months }}
        remaining={remaining}
        remainingByMonth={remainingByMonth}
        submittedOn={submittedOn}
        lockedMonths={[...lockedMonthKeys]}
        today={todayIso()}
        activeMonth={expense.month}
        initialFundingSourceId={expense.fundingSourceId}
        headerSelectedSourceId={headerSelectedSourceId}
        readAmounts={readAmounts}
        existing={{
          id: expense.id,
          documents: expense.documents,
          savedReimbursableCents: reimbursableCents(expense),
          // This expense's own source + month — kept meaning exactly that; the form resolves
          // the target source/month warning itself from `submittedOn`.
          monthSubmittedOn: submittedOn[`${expense.fundingSourceId}:${expense.month}`] ?? null,
          values: {
            id: expense.id,
            name: expense.name,
            fundingSourceId: expense.fundingSourceId,
            lineItemId: expense.lineItemId,
            paymentSource: expense.paymentSource,
            month: expense.month,
            date: expense.date,
            description: expense.description,
            taxReimbursable: expense.taxReimbursable,
            feesReimbursable: expense.feesReimbursable,
            subtotal: toMoney(expense.subtotalCents),
            tax: toMoney(expense.taxCents),
            fees: toMoney(expense.feesCents),
            note: expense.note ?? "",
            narrative: expense.narrative ?? "",
            noReceipt: expense.noReceipt,
            noReceiptReason: expense.noReceiptReason ?? "",
          },
        }}
      />
    </div>
  );
}
