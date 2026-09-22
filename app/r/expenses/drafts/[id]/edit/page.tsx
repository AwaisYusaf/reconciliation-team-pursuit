import { notFound, redirect } from "next/navigation";

import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { todayIso } from "@/src/domain/dates";
import { pageTitle } from "@/src/domain/strings";
import { updateDraftAction } from "@/src/modules/expense-imports/draft-actions";
import { loadDraftById } from "@/src/modules/expense-imports/queries";
import { ExpenseForm } from "@/src/modules/expenses/expense-form";
import { loadExpenseFormOptions } from "@/src/modules/expenses/queries";
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

  // Narrowed to the draft's OWN source, and the month list to its OWN month:
  // `updateDraftAction` writes neither the funding source nor the month, so offering either as
  // a choice would silently discard it — a one-entry source list already renders as static
  // text in the form.
  const fundingSources = options.fundingSources.filter(
    (source) => source.id === draft.fundingSourceId,
  );
  const source = fundingSources[0];

  const toMoney = (cents: number) => (cents / 100).toFixed(2);

  return (
    <div>
      <PageTitle className="mb-2">Edit draft</PageTitle>
      <Subtext className="mb-[30px] max-w-[60ch]">{draft.name}</Subtext>

      <ExpenseForm
        options={{ ...options, fundingSources, months: [draft.month] }}
        // A draft is in no total and no line-item spend (PHASE-14.md §6), so there is no
        // projection to show rather than implying one.
        remaining={{}}
        // Only ever used as a new expense's default date, so it never reaches this form; kept
        // honest rather than passing the draft's own date under the name `today`.
        today={todayIso()}
        activeMonth={draft.month}
        initialFundingSourceId={draft.fundingSourceId}
        headerSelectedSourceId={headerSelectedSourceId}
        // Re-reading amounts for an existing draft is out of scope ("Not part of this ticket").
        readAmounts={false}
        existing={{
          id: draft.id,
          documents: [],
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
            subtotal: toMoney(draft.subtotalCents),
            tax: toMoney(draft.taxCents),
            fees: toMoney(draft.feesCents),
            note: draft.note ?? "",
            narrative: draft.narrative ?? "",
            noReceipt: false,
            noReceiptReason: "",
          },
        }}
        saveAction={updateDraftAction}
      />
    </div>
  );
}
