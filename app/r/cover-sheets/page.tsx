import Link from "next/link";
import { redirect } from "next/navigation";

import { BlockingPanel } from "@/src/components/ui/blocking-panel";
import { PickFundingSource } from "@/src/components/app-shell/pick-funding-source";
import { TourSequenceSkip } from "@/src/components/app-shell/tour-sequence-skip";
import { DownloadButton } from "@/src/components/ui/download-button";
import {
  EmptyState,
  PageHeader,
  SectionTitle,
} from "@/src/components/ui/surfaces";
import { TourGuide } from "@/src/components/ui/tour";
import { loadLineItemBudgets } from "@/src/db/queries";
import { coverSheetRows } from "@/src/domain/cover-sheet";
import { monthLabel } from "@/src/domain/dates";
import { blockingRecords, type GateExpense } from "@/src/domain/gate";
import { coverSheetTitle, pageTitle, UI } from "@/src/domain/strings";
import { loadMonthExpenses, type ExpenseDetail } from "@/src/modules/expenses/queries";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { COVER_SHEETS_TOUR_STEPS } from "@/src/modules/tours/cover-sheets-tour";
import { hasSeenTour } from "@/src/modules/tours/queries";
import { getSession } from "@/src/services/auth/session";

import { CoverSheetPreview, type PreviewRow } from "./cover-sheet-preview";
import { ALL_LINE_ITEMS } from "./constants";
import { LineItemSelect } from "./line-item-select";

export const metadata = { title: pageTitle("Cover Sheets") };

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

  const { selectedId: fundingSourceId, activeSources, sources } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );
  if (fundingSourceId === null) {
    return (
      <div>
        {/* Nothing here for the cover sheets tour to point at, so a running walkthrough is
            handed on rather than stopping at this screen — this is the first of the three
            "choose a source" tabs it reaches, so stopping here cost five tours, not one. */}
        <TourSequenceSkip tour="cover_sheets" />
        <PageHeader
          title="Cover Sheets"
          subtext={`Cover sheets for ${monthLabel(session.activeMonth)}, one for each line item.`}
        />
        <PickFundingSource
          sources={activeSources}
          archivedSources={sources.filter((s) => s.archivedAt !== null)}
        />
      </div>
    );
  }

  const month = session.activeMonth;
  const [lineItems, expenses, seenCoverSheetsTour] = await Promise.all([
    loadLineItemBudgets(session.orgId, fundingSourceId),
    loadMonthExpenses(session.orgId, fundingSourceId, month),
    hasSeenTour(session.userId, "cover_sheets"),
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
        <PageHeader title="Cover Sheets" subtext={`Cover sheets for ${label}, one for each line item.`} />
        <EmptyState>
          No line items yet. Set up your budget in{" "}
          <Link href="/r/line-items" className="text-accent underline">
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
      <TourGuide tour="cover_sheets" steps={COVER_SHEETS_TOUR_STEPS} alreadySeen={seenCoverSheetsTour} />
      <PageHeader
        title="Cover Sheets"
        subtext={`Cover sheets for ${label}, one for each line item.`}
        actions={
          <div data-tour="cover-sheet-line-item-picker">
            <LineItemSelect lineItems={lineItems} selected={selected} />
          </div>
        }
      />

      <div className="flex flex-col gap-10">
        {shown.map((lineItem) => (
          <CoverSheetSection
            key={lineItem.id}
            // The name printed on documents, not the legal name (R6.1) — the preview's whole
            // purpose is to show exactly what the generated file will say, so it resolves the
            // way the snapshot does: the source's own document name, else the org's (D-93).
            docName={sources.find((source) => source.id === fundingSourceId)?.docName ?? session.docName}
            monthLabelText={label}
            month={month}
            fundingSourceId={fundingSourceId}
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
  fundingSourceId,
  lineItem,
  expenses,
}: {
  docName: string;
  monthLabelText: string;
  month: string;
  fundingSourceId: string;
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
    hasNarrative: (expense.narrative ?? "").trim() !== "",
    documents: expense.documents,
  }));
  const blocking = blockingRecords(gate);

  const composed = coverSheetRows(expenses, month);
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
          mimeType: document.mimeType,
          // Only images have a stored thumbnail; a PDF proof is labelled instead of broken.
          isImage: document.mimeType.startsWith("image/"),
        })),
    };
  });

  const href = `/api/downloads/cover-sheet?month=${month}&lineItem=${lineItem.id}&source=${fundingSourceId}`;

  return (
    <section>
      <SectionHeading title={lineItem.name} />

      {blocking.length > 0 && (
        <BlockingPanel
          data-tour="cover-sheet-blocked"
          title={UI.blockedTitleLineItem}
          intro={UI.blockedIntro}
          records={blocking}
          className="mb-5"
        />
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

      <div data-tour="cover-sheet-preview">
        <CoverSheetPreview
          title={title}
          rows={rows}
          totalCents={composed.totalCents}
          // Placeholders are a screen-only affordance; the gate keeps them out of any file.
          showMissingProofPlaceholders
        />
      </div>
    </section>
  );
}

function SectionHeading({ title }: { title: string }) {
  return <SectionTitle className="mb-3">{title}</SectionTitle>;
}
