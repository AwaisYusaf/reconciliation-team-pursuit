import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { buttonClassName } from "@/src/components/ui/button";
import { DangerPanel, PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { db } from "@/src/db";
import { paymentSources } from "@/src/db/schema";
import { isValidMonthKey, monthLabel } from "@/src/domain/dates";
import { expenseReference } from "@/src/domain/strings";
import { documentationStatus, type GateExpense } from "@/src/domain/gate";
import { reimbursableCents } from "@/src/domain/money";
import { loadMonthExpenses } from "@/src/modules/expenses/queries";
import { getSession } from "@/src/services/auth/session";

import { ExpensesTable, type ExpenseRow, type RowDocument } from "./expenses-table";

/** The attached documents of one kind, in the shape the row's viewer needs. */
function viewable(
  documents: { id: string; kind: string; status: string; filename: string; mimeType: string }[],
  kind: string,
): RowDocument[] {
  return documents
    .filter((document) => document.kind === kind && document.status === "attached")
    .map(({ id, filename, mimeType }) => ({ id, filename, mimeType }));
}

export const metadata = { title: "Expenses — Grant Expense Reconciliation" };

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Saving or editing an expense into a month other than the org's active one (R2.2 lets
  // the form's own month field differ from it) used to redirect here regardless, landing on
  // the active month's list with no sign the save had gone somewhere else — indistinguishable
  // from the record having vanished. The save always passes its own month back explicitly now,
  // shown here instead of (never persisted as) the org-wide active month, which stays exactly
  // what it was (R2.3) — one save must not silently redirect the whole organisation's shared
  // reporting period out from under everyone else using it.
  const { month: requestedMonth } = await searchParams;
  const viewingRequestedMonth = Boolean(requestedMonth && isValidMonthKey(requestedMonth));
  const month = viewingRequestedMonth ? requestedMonth! : session.activeMonth;

  const [expenses, sources] = await Promise.all([
    loadMonthExpenses(session.orgId, month),
    db
      .select({ label: paymentSources.label })
      .from(paymentSources)
      .where(and(eq(paymentSources.orgId, session.orgId), eq(paymentSources.active, true)))
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
      reference: expenseReference(expense.month, expense.referenceSeq),
      date: expense.date,
      name: expense.name,
      description: expense.description,
      lineItemName: expense.lineItemName,
      paymentSource: expense.paymentSource,
      reimbursableCents: reimbursableCents(expense),
      // The whole attached set per kind, not a count and a first id: the row opens a viewer
      // that pages through them, and an expense with three receipts could otherwise only ever
      // show the first. Only `attached` documents are included — a pending or failed upload
      // has no bytes to show, which is also what the counts have always meant.
      proofs: viewable(expense.documents, "proof"),
      receipts: viewable(expense.documents, "receipt"),
      supporting: viewable(expense.documents, "supporting"),
      // Every attached document, in the order the packet shows them. The reference is the
      // handle SQA asked for: one click on it opens the whole evidence set for the expense,
      // rather than making someone open proof, receipt and supporting separately.
      allDocuments: [
        ...viewable(expense.documents, "proof"),
        ...viewable(expense.documents, "receipt"),
        ...viewable(expense.documents, "supporting"),
      ],
      noReceipt: expense.noReceipt,
      noReceiptReason: expense.noReceiptReason,
      complete: status.complete,
      // Kept, not recomputed in the table: the documentation filter reads this so it and the
      // packet's blocking list are the same judgement (R4.3).
      missing: status.missing,
    };
  });

  // Cards cover every source present in the month, including labels since retired (R5.2).
  const labels = [...new Set([...sources.map((row) => row.label), ...rows.map((row) => row.paymentSource)])];

  const viewingOtherMonth = viewingRequestedMonth && month !== session.activeMonth;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <PageTitle className="mb-1.5">Expenses This Month</PageTitle>
          <Subtext>{monthLabel(month)}</Subtext>
          {viewingOtherMonth && (
            <DangerPanel tone="notice" className="mt-3 max-w-[560px]">
              This is where your last save landed — not your active month (
              {monthLabel(session.activeMonth)}).{" "}
              <Link href="/expenses" className="underline">
                Go to your active month
              </Link>
              .
            </DangerPanel>
          )}
        </div>
        <Link
          href="/expenses/trash"
          className={buttonClassName("secondary", "min-h-11 px-4 text-[15px] gap-2")}
        >
          <svg viewBox="0 0 20 20" className="w-4 h-4 flex-none" aria-hidden="true">
            <path
              d="M4 6h12M8 6V4.5A1.5 1.5 0 019.5 3h1A1.5 1.5 0 0112 4.5V6m-6.5 0 .6 9.4a1.5 1.5 0 001.497 1.4h3.806a1.5 1.5 0 001.497-1.4L14.5 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Trash
        </Link>
      </div>

      <ExpensesTable
        rows={rows}
        paymentSourceLabels={labels}
        lineItemNames={[...new Set(rows.map((row) => row.lineItemName))].sort()}
        month={monthLabel(month)}
      />
    </div>
  );
}
