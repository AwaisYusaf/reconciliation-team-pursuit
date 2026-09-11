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

  const { selectedId, activeSources } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );

  // Defensive fallback only — Phase 3 refuses archiving the last active source, so this
  // should be unreachable, but the page must not crash if it somehow were.
  if (activeSources.length === 0) {
    return (
      <div>
        <PageTitle className="mb-2">Add Expense</PageTitle>
        <PickFundingSource sources={activeSources} />
      </div>
    );
  }

  // The header may hold an archived source (history stays viewable), but a new expense can
  // only go on an active one — the form's options are active-only, so pre-filling an archived
  // id left it with no line items and, with one active source, no control to fix it.
  const initialFundingSourceId =
    activeSources.find((source) => source.id === selectedId)?.id ?? activeSources[0].id;
  const month = session.activeMonth;
  const options = await loadExpenseFormOptions(session.orgId, null);

  // Remaining per line item drives the live projection as the user types (R3.7). Line item
  // ids are UUIDs and unique across sources, so every source's figures merge into one flat
  // map without collision.
  const remaining: Record<string, number> = {};
  await Promise.all(
    options.fundingSources.map(async (source) => {
      const [lineItems, amounts] = await Promise.all([
        loadLineItemBudgets(session.orgId, source.id),
        loadExpenseAmounts(session.orgId, source.id, month),
      ]);
      for (const row of allLineItemStats(lineItems, amounts, month)) {
        remaining[row.lineItem.id] = row.remainingCents;
      }
    }),
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
        initialFundingSourceId={initialFundingSourceId}
      />
    </div>
  );
}
