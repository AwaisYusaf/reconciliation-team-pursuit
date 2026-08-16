import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { db } from "@/src/db";
import { loadExpenseAmounts, loadLineItemBudgets } from "@/src/db/queries";
import { monthStatuses } from "@/src/db/schema";
import { allLineItemStats } from "@/src/domain/budget-math";
import { monthWindow, todayIso } from "@/src/domain/dates";
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

  const [options, lineItems, amounts, submitted] = await Promise.all([
    loadExpenseFormOptions(session.orgId),
    loadLineItemBudgets(session.orgId),
    loadExpenseAmounts(session.orgId, expense.month),
    db
      .select({ submittedAt: monthStatuses.submittedAt })
      .from(monthStatuses)
      .where(
        and(eq(monthStatuses.orgId, session.orgId), eq(monthStatuses.month, expense.month)),
      )
      .limit(1),
  ]);

  const remaining = Object.fromEntries(
    allLineItemStats(lineItems, amounts, expense.month).map((row) => [
      row.lineItem.id,
      row.remainingCents,
    ]),
  );

  const toMoney = (cents: number) => (cents / 100).toFixed(2);

  return (
    <div>
      <PageTitle className="mb-2">Edit Expense</PageTitle>
      <Subtext className="mb-[30px] max-w-[60ch]">{expense.name}</Subtext>

      <ExpenseForm
        options={{ ...options, months: monthWindow([expense.month, session.activeMonth]) }}
        remaining={remaining}
        today={todayIso()}
        activeMonth={expense.month}
        existing={{
          id: expense.id,
          documents: expense.documents,
          savedReimbursableCents: reimbursableCents(expense),
          monthSubmitted: Boolean(submitted[0]?.submittedAt),
          values: {
            id: expense.id,
            name: expense.name,
            lineItemId: expense.lineItemId,
            paymentSource: expense.paymentSource,
            month: expense.month,
            date: expense.date,
            description: expense.description,
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
