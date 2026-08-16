import Link from "next/link";
import { redirect } from "next/navigation";

import { DownloadButton } from "@/src/components/ui/download-button";
import { DangerPanel, EmptyState, PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { loadLineItemBudgets } from "@/src/db/queries";
import { coverSheetRows } from "@/src/domain/cover-sheet";
import { monthLabel } from "@/src/domain/dates";
import { blockingRecords, type GateExpense } from "@/src/domain/gate";
import { coverSheetTitle, UI } from "@/src/domain/strings";
import { loadMonthExpenses, type ExpenseDetail } from "@/src/modules/expenses/queries";
import { getSession } from "@/src/services/auth/session";

import { CoverSheetPreview, type PreviewRow } from "./cover-sheet-preview";
import { ALL_LINE_ITEMS } from "./constants";
import { LineItemSelect } from "./line-item-select";

export const metadata = { title: "Cover Sheets — Grant Expense Reconciliation" };

/**
 * m04 — the Breakdown document preview and its downloads.
 *
 * The preview is composed through the same `coverSheetRows` the generator uses, so what is
 * shown here and what the City receives cannot describe different amounts or notes.
 */
export default async function CoverSheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ lineItem?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const month = session.activeMonth;
  const [lineItems, expenses] = await Promise.all([
    loadLineItemBudgets(session.orgId),
    loadMonthExpenses(session.orgId, month),
  ]);

  const { lineItem: requested } = await searchParams;
  // An unknown or absent id falls back to the first line item rather than erroring — the
  // parameter comes from a URL anyone can edit.
  const selected =
    requested === ALL_LINE_ITEMS
      ? ALL_LINE_ITEMS
      : (lineItems.find((item) => item.id === requested)?.id ?? lineItems[0]?.id ?? ALL_LINE_ITEMS);

  const label = monthLabel(month);

  if (lineItems.length === 0) {
    return (
      <div>
        <PageTitle className="mb-1.5">Cover Sheets</PageTitle>
        <Subtext className="mb-[26px]">Breakdown documents for {label}.</Subtext>
        <EmptyState>
          No line items yet — set up your budget in{" "}
          <Link href="/line-items" className="text-accent underline">
            Line Items
          </Link>
          .
        </EmptyState>
      </div>
    );
  }

  const shown =
    selected === ALL_LINE_ITEMS ? lineItems : lineItems.filter((item) => item.id === selected);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-5 mb-1.5">
        <PageTitle>Cover Sheets</PageTitle>
        <LineItemSelect lineItems={lineItems} selected={selected} />
      </div>
      <Subtext className="mb-[26px]">Breakdown documents for {label}.</Subtext>

      <div className="flex flex-col gap-10">
        {shown.map((lineItem) => (
          <CoverSheetSection
            key={lineItem.id}
            // The name printed on documents, not the legal name (R6.1) — the preview's whole
            // purpose is to show exactly what the generated file will say.
            docName={session.docName}
            monthLabelText={label}
            month={month}
            lineItem={lineItem}
            expenses={expenses.filter((expense) => expense.lineItemId === lineItem.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** One line item's sheet: gate panel, downloads, preview. */
function CoverSheetSection({
  docName,
  monthLabelText,
  month,
  lineItem,
  expenses,
}: {
  docName: string;
  monthLabelText: string;
  month: string;
  lineItem: { id: string; name: string };
  expenses: ExpenseDetail[];
}) {
  const title = coverSheetTitle(docName, monthLabelText, lineItem.name);

  if (expenses.length === 0) {
    return (
      <section>
        <SectionHeading title={lineItem.name} />
        <EmptyState>
          No expenses recorded for {monthLabelText} in {lineItem.name} yet.
        </EmptyState>
      </section>
    );
  }

  const gate: GateExpense[] = expenses.map((expense) => ({
    id: expense.id,
    name: expense.name,
    lineItemName: expense.lineItemName,
    noReceipt: expense.noReceipt,
    documents: expense.documents,
  }));
  const blocking = blockingRecords(gate);

  const composed = coverSheetRows(expenses);
  const rows: PreviewRow[] = composed.rows.map((row, index) => {
    const expense = expenses[index];
    return {
      ...row,
      expenseId: expense.id,
      proofs: expense.documents
        .filter((document) => document.kind === "proof" && document.status === "attached")
        .map((document) => ({
          id: document.id,
          filename: document.filename,
          // Only images have a stored thumbnail; a PDF proof is labelled instead of broken.
          isImage: document.mimeType.startsWith("image/"),
        })),
    };
  });

  const href = `/api/downloads/cover-sheet?month=${month}&lineItem=${lineItem.id}`;

  return (
    <section>
      <SectionHeading title={lineItem.name} />

      {blocking.length > 0 && (
        <DangerPanel title={UI.blockedTitleLineItem} className="mb-5 max-w-[820px]">
          <p className="mt-1.5">{UI.blockedIntro}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {blocking.map((record) => (
              <li key={record.expenseId} className="flex flex-wrap items-baseline gap-2">
                <span>{record.label}</span>
                {/* R4.4: each record links straight to the expense that needs fixing. This
                    screen is where the gap is most often discovered. */}
                <Link
                  href={`/expenses/${record.expenseId}/edit`}
                  className="underline text-danger font-medium"
                >
                  Open expense
                </Link>
              </li>
            ))}
          </ul>
        </DangerPanel>
      )}

      {/* Buttons live on each sheet, so they are still reachable in All Line Items mode. */}
      <div className="flex flex-wrap gap-3 mb-5">
        <DownloadButton href={href} variant="secondary" disabled={blocking.length > 0}>
          Download Word
        </DownloadButton>
        <DownloadButton
          href={`${href}&format=pdf`}
          variant="secondary"
          disabled={blocking.length > 0}
        >
          Download PDF
        </DownloadButton>
      </div>

      <CoverSheetPreview
        title={title}
        rows={rows}
        totalCents={composed.totalCents}
        // Placeholders are a screen-only affordance; the gate keeps them out of any file.
        showMissingProofPlaceholders
      />
    </section>
  );
}

function SectionHeading({ title }: { title: string }) {
  return <h2 className="font-serif text-xl text-ink mb-3">{title}</h2>;
}
