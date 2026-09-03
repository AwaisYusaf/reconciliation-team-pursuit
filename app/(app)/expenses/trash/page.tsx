import { redirect } from "next/navigation";

import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { formatDateUS, monthLabel, todayIso } from "@/src/domain/dates";
import { loadTrashedExpenses } from "@/src/modules/expenses/queries";
import { getSession } from "@/src/services/auth/session";

import { TrashTable, type TrashRow } from "./trash-table";

export const metadata = { title: "Trash — Grant Expense Reconciliation" };

export default async function ExpenseTrashPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const expenses = await loadTrashedExpenses(session.orgId);
  const rows: TrashRow[] = expenses.map((expense) => ({
    id: expense.id,
    name: expense.name,
    lineItemName: expense.lineItemName,
    month: monthLabel(expense.month),
    amountCents: expense.amountCents,
    deletedAt: formatDateUS(todayIso(expense.deletedAt)),
    // Only "attached" documents — a pending or failed upload has no bytes to preview, which
    // is also what the active expenses list means by this.
    documents: expense.documents
      .filter((document) => document.status === "attached")
      .map(({ id, filename, mimeType }) => ({ id, filename, mimeType })),
  }));

  return (
    <div>
      <PageTitle className="mb-1.5">Trash</PageTitle>
      <Subtext className="mb-6">
        Deleted expenses, across every month. Restore one, or delete it for good.
      </Subtext>

      <TrashTable rows={rows} />
    </div>
  );
}
