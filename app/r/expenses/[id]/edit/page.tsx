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
import { ExpenseForm } from "@/src/modules/expenses/expense-form";
import { loadExpense, loadExpenseFormOptions } from "@/src/modules/expenses/queries";
import { getSession } from "@/src/services/auth/session";

export const metadata = { title: "Edit Expense — Grant Expense Reconciliation" };

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

  const [options, lineItems, months, submittedRows] = await Promise.all([
    loadExpenseFormOptions(session.orgId, fundingSourceId),
    loadLineItemBudgets(session.orgId, fundingSourceId),
    // The same list the header offers: a month you can view must be one you can move into.
    loadSelectableMonths(session.orgId, fundingSourceId, [expense.month, session.activeMonth]),
    db
      .select({ month: monthStatuses.month, submittedAt: monthStatuses.submittedAt })
      .from(monthStatuses)
      .where(
        and(
          eq(monthStatuses.orgId, session.orgId),
          eq(monthStatuses.fundingSourceId, fundingSourceId),
          isNotNull(monthStatuses.submittedAt),
        ),
      ),
  ]);

  // The Month dropdown moves the expense (R2.2), so both the budget projection and the
  // submitted-month warning have to describe the month currently *selected* — not the one
  // the expense happens to sit in now. Both were resolved for the source month alone, which
  // meant moving into a submitted month warned about nothing and the R3.7 projection quietly
  // described the wrong month's budget.
  const amounts = await loadExpenseAmounts(session.orgId, fundingSourceId, months[0] ?? expense.month);
  const remainingByMonth = Object.fromEntries(
    months.map((month) => [
      month,
      Object.fromEntries(
        allLineItemStats(lineItems, amounts, month).map((row) => [
          row.lineItem.id,
          row.remainingCents,
        ]),
      ),
    ]),
  );
  const remaining = remainingByMonth[expense.month] ?? {};

  const submittedOn = Object.fromEntries(
    submittedRows
      .filter((row) => row.submittedAt)
      .map((row) => [row.month, formatDateUS(todayIso(row.submittedAt!))]),
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
        today={todayIso()}
        activeMonth={expense.month}
        existing={{
          id: expense.id,
          documents: expense.documents,
          savedReimbursableCents: reimbursableCents(expense),
          monthSubmittedOn: submittedOn[expense.month] ?? null,
          values: {
            id: expense.id,
            name: expense.name,
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
