import { notFound, redirect } from "next/navigation";

import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { todayIso } from "@/src/domain/dates";
import { pageTitle } from "@/src/domain/strings";
import {
  approveDraftAction,
  removeDraftDocumentAction,
  updateDraftAction,
} from "@/src/modules/expense-imports/draft-actions";
import { loadDraftById, loadDraftDocuments } from "@/src/modules/expense-imports/queries";
import { ExpenseForm } from "@/src/modules/expenses/expense-form";
import { moneyField } from "@/src/modules/expenses/vendor-fill";
import { loadExpenseFormOptions } from "@/src/modules/expenses/queries";
import { loadExpenseAmounts, loadLineItemBudgets } from "@/src/db/queries";
import { allLineItemStats } from "@/src/domain/budget-math";
import { readAmountsAllowedForOrg } from "@/src/modules/ai/access";
import { and, eq } from "drizzle-orm";
import { db } from "@/src/db";
import { expenseImports } from "@/src/db/schema";
import { inlineSrc } from "@/src/services/storage/preview";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { getSession } from "@/src/services/auth/session";

export const metadata = { title: pageTitle("Edit draft") };

export default async function EditDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const draft = await loadDraftById(session.orgId, id);
  // Org-scoped lookup: another organisation's id is simply not found.
  if (!draft) notFound();

  const [options, { selectedId: headerSelectedSourceId }] = await Promise.all([
    loadExpenseFormOptions(session.orgId, draft.fundingSourceId),
    loadSourceContext(session.orgId, session.activeFundingSourceId),
  ]);

  // The invoice this draft was read from, so the receipt field can show the bill itself. The
  // file belongs to the import, not to the draft, which is why it is fetched separately and
  // shown as something to open rather than as an attached document.
  const [invoice] = await db
    .select({ id: expenseImports.id, filename: expenseImports.filename })
    .from(expenseImports)
    .where(and(eq(expenseImports.id, draft.importId), eq(expenseImports.orgId, session.orgId)))
    .limit(1);

  const [readAmounts, lineItemBudgets, amounts, documents] = await Promise.all([
    readAmountsAllowedForOrg(session.orgId),
    loadLineItemBudgets(session.orgId, draft.fundingSourceId),
    loadExpenseAmounts(session.orgId, draft.fundingSourceId, draft.month),
    // The draft's own files, which approval re-points at the expense. Shown here for the same
    // reason an expense's are: without them, someone who already attached a proof sees an
    // empty field and attaches it a second time.
    loadDraftDocuments(session.orgId, draft.id),
  ]);
  const remaining: Record<string, number> = {};
  for (const row of allLineItemStats(lineItemBudgets, amounts, draft.month)) {
    remaining[row.lineItem.id] = row.remainingCents;
  }

  // Narrowed to the draft's OWN source, and the month list to its OWN month:
  // `updateDraftAction` writes neither the funding source nor the month, so offering either as
  // a choice would silently discard it — a one-entry source list already renders as static
  // text in the form.
  const fundingSources = options.fundingSources.filter(
    (source) => source.id === draft.fundingSourceId,
  );
  const source = fundingSources[0];

  return (
    <div>
      <PageTitle className="mb-2">Edit draft</PageTitle>
      <Subtext className="mb-[30px] max-w-[60ch]">{draft.name}</Subtext>

      <ExpenseForm
        options={{ ...options, fundingSources, months: [draft.month] }}
        // The same live projection the Add Expense form shows. A draft is in no total itself
        // (PHASE-14.md §6), so this is what is left BEFORE this charge, which is exactly the
        // figure someone needs while deciding which line item it belongs on.
        remaining={remaining}
        // Only ever used as a new expense's default date, so it never reaches this form; kept
        // honest rather than passing the draft's own date under the name `today`.
        today={todayIso()}
        activeMonth={draft.month}
        initialFundingSourceId={draft.fundingSourceId}
        headerSelectedSourceId={headerSelectedSourceId}
        readAmounts={readAmounts}
        invoiceReceipt={
          invoice ? { filename: invoice.filename, href: inlineSrc(invoice.id) } : undefined
        }
        existing={{
          id: draft.id,
          documents,
          savedReimbursableCents: 0,
          monthSubmittedOn: null,
          values: {
            id: draft.id,
            name: draft.name,
            fundingSourceId: draft.fundingSourceId,
            lineItemId: draft.lineItemId ?? "",
            paymentSource: draft.paymentSource,
            month: draft.month,
            date: draft.date,
            description: draft.description,
            // The drafts table has no such columns — approval resolves them from the funding
            // source, so the form reads them from there too.
            taxReimbursable: source?.taxReimbursable ?? false,
            feesReimbursable: source?.feesReimbursable ?? false,
            subtotal: moneyField(draft.subtotalCents),
            tax: moneyField(draft.taxCents),
            fees: moneyField(draft.feesCents),
            note: draft.note ?? "",
            narrative: draft.narrative ?? "",
            noReceipt: false,
            noReceiptReason: "",
          },
        }}
        saveAction={updateDraftAction}
        // Passed always. Whether the button SHOWS is decided in the form, off the fields as
        // they stand on screen: this page renders on the server, so gating here hid it from
        // every draft still missing its narrative — which is what someone opens this screen to
        // write. Approval re-checks everything server side either way.
        approveAction={approveDraftAction}
        removeDocumentAction={removeDraftDocumentAction}
      />
    </div>
  );
}
