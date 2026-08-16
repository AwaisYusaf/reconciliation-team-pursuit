import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { db } from "@/src/db";
import { paymentSources } from "@/src/db/schema";
import { monthLabel } from "@/src/domain/dates";
import { documentationStatus, type GateExpense } from "@/src/domain/gate";
import { reimbursableCents } from "@/src/domain/money";
import { loadMonthExpenses } from "@/src/modules/expenses/queries";
import { getSession } from "@/src/services/auth/session";

import { ExpensesTable, type ExpenseRow } from "./expenses-table";

export const metadata = { title: "Expenses — Grant Expense Reconciliation" };

export default async function ExpensesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const month = session.activeMonth;
  const [expenses, sources] = await Promise.all([
    loadMonthExpenses(session.orgId, month),
    db
      .select({ label: paymentSources.label })
      .from(paymentSources)
      .where(eq(paymentSources.orgId, session.orgId))
      .orderBy(asc(paymentSources.sortOrder)),
  ]);

  const rows: ExpenseRow[] = expenses.map((expense) => {
    const gate: GateExpense = {
      id: expense.id,
      name: expense.name,
      lineItemName: expense.lineItemName,
      noReceipt: expense.noReceipt,
      documents: expense.documents,
    };
    const status = documentationStatus(gate);

    return {
      id: expense.id,
      date: expense.date,
      name: expense.name,
      lineItemName: expense.lineItemName,
      paymentSource: expense.paymentSource,
      reimbursableCents: reimbursableCents(expense),
      proofCount: expense.documents.filter((d) => d.kind === "proof" && d.status === "attached").length,
      receiptCount: expense.documents.filter((d) => d.kind === "receipt" && d.status === "attached").length,
      supportingCount: expense.documents.filter((d) => d.kind === "supporting" && d.status === "attached").length,
      firstProofId: expense.documents.find((d) => d.kind === "proof")?.id ?? null,
      firstReceiptId: expense.documents.find((d) => d.kind === "receipt")?.id ?? null,
      noReceipt: expense.noReceipt,
      noReceiptReason: expense.noReceiptReason,
      complete: status.complete,
    };
  });

  // Cards cover every source present in the month, including labels since retired (R5.2).
  const labels = [...new Set([...sources.map((row) => row.label), ...rows.map((row) => row.paymentSource)])];

  return (
    <div>
      <PageTitle className="mb-1.5">Expenses This Month</PageTitle>
      <Subtext className="mb-6">{monthLabel(month)}</Subtext>

      <ExpensesTable
        rows={rows}
        paymentSourceLabels={labels}
        lineItemNames={[...new Set(rows.map((row) => row.lineItemName))].sort()}
        month={monthLabel(month)}
      />
    </div>
  );
}
