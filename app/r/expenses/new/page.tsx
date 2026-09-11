import { redirect } from "next/navigation";

import { PickFundingSource } from "@/src/components/app-shell/pick-funding-source";
import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { loadExpenseAmounts, loadLineItemBudgets } from "@/src/db/queries";
import { allLineItemStats } from "@/src/domain/budget-math";
import { monthLabel, monthWindow, todayIso } from "@/src/domain/dates";
import { ExpenseForm } from "@/src/modules/expenses/expense-form";
import { loadExpenseFormOptions } from "@/src/modules/expenses/queries";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { getSession } from "@/src/services/auth/session";

export const metadata = { title: "Add Expense — Grant Expense Reconciliation" };

export default async function NewExpensePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { selectedId: fundingSourceId, activeSources } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );
  if (fundingSourceId === null) {
    return (
      <div>
        <PageTitle className="mb-2">Add Expense</PageTitle>
        <PickFundingSource sources={activeSources} />
      </div>
    );
  }

  const month = session.activeMonth;
  const [options, lineItems, amounts] = await Promise.all([
    loadExpenseFormOptions(session.orgId, fundingSourceId),
    loadLineItemBudgets(session.orgId, fundingSourceId),
    loadExpenseAmounts(session.orgId, fundingSourceId, month),
  ]);

  // Remaining per line item drives the live projection as the user types (R3.7).
  const remaining = Object.fromEntries(
    allLineItemStats(lineItems, amounts, month).map((row) => [
      row.lineItem.id,
      row.remainingCents,
    ]),
  );

  return (
    <div>
      <PageTitle className="mb-2">Add Expense</PageTitle>
      <Subtext className="mb-[30px] max-w-[60ch]">
        Enter one expense for {monthLabel(month)}. It will appear on the Expenses list and the
        matching cover sheet right away.
      </Subtext>

      <ExpenseForm
        options={{ ...options, months: monthWindow([month]) }}
        remaining={remaining}
        today={todayIso()}
        activeMonth={month}
      />
    </div>
  );
}
