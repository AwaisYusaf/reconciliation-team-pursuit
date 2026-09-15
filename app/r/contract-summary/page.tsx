import Link from "next/link";
import { redirect } from "next/navigation";

import { PickFundingSource } from "@/src/components/app-shell/pick-funding-source";
import { TourSequenceSkip } from "@/src/components/app-shell/tour-sequence-skip";
import { DownloadButton } from "@/src/components/ui/download-button";
import { Card, EmptyState, PageTitle, SectionTitle, Subtext } from "@/src/components/ui/surfaces";
import { SectionRow, TableCard, Td, Th } from "@/src/components/ui/table";
import { TourGuide } from "@/src/components/ui/tour";
import { loadExpenseAmounts, loadFundingSourceSettings, loadLineItemBudgets } from "@/src/db/queries";
import { db } from "@/src/db";
import { fundingSources } from "@/src/db/schema";
import { contractContextItems } from "@/src/domain/contract-context";
import { formatDateUS, monthLabel, todayIso } from "@/src/domain/dates";
import { formatMoney, formatPercent, summaryRowLabel } from "@/src/domain/format";
import { blockingRecords, type GateExpense } from "@/src/domain/gate";
import { downloadBlockedReason, UI } from "@/src/domain/strings";
import { contractSummary, type SummaryRow } from "@/src/domain/summary";
import { loadMonthExpenses } from "@/src/modules/expenses/queries";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadReportingPeriods, type LockEventRow, type ReportingPeriod } from "@/src/modules/packet/queries";
import { CONTRACT_SUMMARY_TOUR_STEPS } from "@/src/modules/tours/contract-summary-tour";
import { hasSeenTour } from "@/src/modules/tours/queries";
import { getSession } from "@/src/services/auth/session";
import { and, eq } from "drizzle-orm";

export const metadata = { title: "Contract Summary — Grant Expense Reconciliation" };

const COLUMNS = 7;

/**
 * m07 — the on-screen mirror of the Excel workbook.
 *
 * Every figure comes from the same calculation service the workbook uses, so the screen and
 * the file the City receives cannot disagree (R10.2).
 */
export default async function ContractSummaryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { selectedId: fundingSourceId, activeSources, sources } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );
  const month = session.activeMonth;

  if (fundingSourceId === null) {
    return (
      <div>
        {/* Nothing here for the contract summary tour to point at, so a running walkthrough is
            handed on rather than stopping at this screen. */}
        <TourSequenceSkip tour="contract_summary" />
        <PageTitle className="mb-1.5">Contract Summary</PageTitle>
        <Subtext className="mb-[26px]">Contract position for {monthLabel(month)}.</Subtext>
        <PickFundingSource
          sources={activeSources}
          archivedSources={sources.filter((s) => s.archivedAt !== null)}
        />
      </div>
    );
  }

  const [
    lineItems,
    amounts,
    settings,
    identifiers,
    monthExpenses,
    seenContractSummaryTour,
    reportingPeriods,
  ] = await Promise.all([
    loadLineItemBudgets(session.orgId, fundingSourceId),
    loadExpenseAmounts(session.orgId, fundingSourceId, month),
    loadFundingSourceSettings(session.orgId, fundingSourceId),
    db
      .select({
        contractNumber: fundingSources.contractNumber,
        basePoNumber: fundingSources.basePoNumber,
        performancePoNumber: fundingSources.performancePoNumber,
      })
      .from(fundingSources)
      .where(and(eq(fundingSources.id, fundingSourceId), eq(fundingSources.orgId, session.orgId)))
      .limit(1),
    loadMonthExpenses(session.orgId, fundingSourceId, month),
    hasSeenTour(session.userId, "contract_summary"),
    loadReportingPeriods(session.orgId, fundingSourceId),
  ]);

  if (lineItems.length === 0) {
    return (
      <div>
        <PageTitle className="mb-1.5">Contract Summary</PageTitle>
        <Subtext className="mb-[26px]">Contract position for {monthLabel(month)}.</Subtext>
        <EmptyState>
          No line items yet — set up your budget in{" "}
          <Link href="/r/line-items" className="text-accent underline">
            Line Items
          </Link>
          .
        </EmptyState>
      </div>
    );
  }

  const summary = contractSummary({ lineItems, expenses: amounts, settings, month });

  const context = contractContextItems(
    {
      contractNumber: identifiers[0]?.contractNumber ?? "",
      basePoNumber: identifiers[0]?.basePoNumber ?? "",
      performancePoNumber: identifiers[0]?.performancePoNumber ?? "",
      contractValueCents: settings.contractValueCents,
      scheduledTotalCents: summary.totals.scheduledCents,
      newPerformanceCents: summary.totals.newPerformanceCents,
    },
    month,
  );

  // The button's state must match what the download route will actually do (R4.3), so the
  // same two refusals are evaluated here: nothing to summarise, and missing documentation.
  const gate: GateExpense[] = monthExpenses.map((expense) => ({
    id: expense.id,
    name: expense.name,
    lineItemName: expense.lineItemName,
    noReceipt: expense.noReceipt,
    hasNarrative: (expense.narrative ?? "").trim() !== "",
    documents: expense.documents,
  }));
  // R4.3 is the only gate the specs put on a download. A month with no expenses still has
  // a meaningful summary — opening balances and the advance reconciliation — and the packet
  // route allows exactly that, so the workbook does too.
  const blockedCount = blockingRecords(gate).length;
  const refusal = blockedCount > 0 ? downloadBlockedReason(blockedCount) : null;

  return (
    <div>
      <TourGuide
        tour="contract_summary"
        steps={CONTRACT_SUMMARY_TOUR_STEPS}
        alreadySeen={seenContractSummaryTour}
      />
      <PageTitle className="mb-1.5">Contract Summary</PageTitle>
      <Subtext className="mb-3.5">Contract position for {monthLabel(month)}.</Subtext>

      <div className="flex flex-wrap gap-x-8 gap-y-1.5 text-base text-muted mb-[26px]">
        {context.map((item) => (
          <span key={item.label}>{item.text}</span>
        ))}
      </div>

      <TableCard minWidth={900} data-tour="contract-summary-table">
        <thead>
          <tr>
            <Th sticky>Description of Work</Th>
            <Th align="right">Scheduled Value</Th>
            <Th align="right">Previously Billed</Th>
            <Th align="right">This Period</Th>
            <Th align="right">Total Billed to Date</Th>
            <Th align="right">% Complete</Th>
            <Th align="right">Balance to Finish</Th>
          </tr>
        </thead>
        <tbody>
          <SectionRow colSpan={COLUMNS}>BASE</SectionRow>
          {summary.baseRows.map((row) => (
            <SummaryTableRow key={row.name} row={row} />
          ))}
          {/* No separate "Base subtotal" row: every line item is a base row now that
              performances (m08) replaced the old Performance Grant section, so it would only
              ever repeat the Totals row directly beneath it. */}
          {/* performanceCents zeroed here only for display: the split annotation belongs to
              an individual line item ("Salary (includes $10,000.00 performance)"), not this
              aggregate row — "Totals (includes ...)" would read as if Totals itself were a
              performance-bearing line item, which it isn't. */}
          <SummaryTableRow row={{ ...summary.totals, performanceCents: 0 }} bold />
        </tbody>
      </TableCard>

      <Card className="max-w-[460px] mt-7" data-tour="contract-summary-reconciliation">
        <ReconciliationRow
          label="Total advances received"
          value={formatMoney(summary.reconciliation.advancesCents)}
        />
        <ReconciliationRow
          label="Total reconciled to date"
          value={formatMoney(summary.reconciliation.reconciledCents)}
        />
        <ReconciliationRow
          label="Balance remaining to reconcile"
          value={formatMoney(summary.reconciliation.balanceCents)}
        />
        <ReconciliationRow
          label="Percentage of advance payments reconciled"
          value={formatPercent(summary.reconciliation.percentReconciled)}
          last
        />
      </Card>

      <div className="mt-7">
        <DownloadButton
          href={`/api/downloads/summary?month=${month}&source=${fundingSourceId}`}
          disabled={refusal !== null}
        >
          Download Summary (Excel)
        </DownloadButton>
        {refusal && <p className="mt-2.5 text-sm text-danger">{refusal}</p>}
      </div>

      <div className="mt-8">
        <SectionTitle className="mb-3">{UI.reportingPeriodsTitle}</SectionTitle>
        {reportingPeriods.length === 0 ? (
          <p className="text-[15px] text-muted">No reporting periods yet.</p>
        ) : (
          // No `minWidth` — three columns with `break-words` cells already fit a phone without
          // forcing the horizontal scroll `TableCard` offers wider tables (judgment call: the
          // plan only requires it not overflow, and this is the smaller of the two ways).
          <TableCard>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th>Status</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {reportingPeriods.map((period) => (
                <ReportingPeriodRows key={period.month} period={period} />
              ))}
            </tbody>
          </TableCard>
        )}
      </div>
    </div>
  );
}

/** A month's status + details row, and — when it was unlocked and locked again — its event
 *  history beneath, oldest first (Appendix A §4). */
function ReportingPeriodRows({ period }: { period: ReportingPeriod }) {
  const lockEvents = period.events.filter((event) => event.isLock);
  // Once locked, a month can only be locked again after an unlock (the guard refuses a
  // second lock), so more than one lock event always means an unlock happened in between.
  const relocked = lockEvents.length > 1;
  const lastLock = lockEvents.at(-1) ?? null;

  const status = period.lockedAt ? UI.reconciledLabel : period.submittedAt ? UI.statusSubmitted : UI.statusOpen;

  const details = period.lockedAt && lastLock ? (
    <>
      {UI.lockedBy(formatDateUS(todayIso(lastLock.createdAt)), lastLock.userDisplay)}{" · "}
      <a
        href={`/api/files/${lastLock.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline"
      >
        {UI.viewSignedPacket}
      </a>
    </>
  ) : period.submittedAt ? (
    UI.submittedOn(formatDateUS(todayIso(period.submittedAt)))
  ) : (
    "—"
  );

  return (
    <>
      <tr>
        <Td>{monthLabel(period.month)}</Td>
        <Td>{status}</Td>
        <Td>{details}</Td>
      </tr>
      {relocked && (
        <tr>
          <td colSpan={3} className="px-3 sm:px-4 py-2 border-b border-line bg-section">
            <ul className="flex flex-col gap-1 text-sm text-muted">
              {period.events.map((event, index) => (
                <EventLine key={event.id} event={event} index={index} events={period.events} />
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function EventLine({
  event,
  index,
  events,
}: {
  event: LockEventRow;
  index: number;
  events: LockEventRow[];
}) {
  const date = formatDateUS(todayIso(event.createdAt));
  if (event.isLock) {
    const replaced = events.slice(index + 1).some((later) => later.isLock);
    return (
      <li>
        {UI.lockedBy(date, event.userDisplay)}{" · "}
        <a
          href={`/api/files/${event.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline"
        >
          {UI.viewSignedPacket}
        </a>
        {replaced && ` ${UI.replacedTag}`}
      </li>
    );
  }
  return <li>{UI.unlockEventLine(date, event.userDisplay, event.reason)}</li>;
}

function SummaryTableRow({ row, bold = false }: { row: SummaryRow; bold?: boolean }) {
  return (
    <tr>
      <Td bold={bold} sticky>{summaryRowLabel(row.name, row.performanceCents)}</Td>
      <Td align="right" numeric bold={bold}>
        {formatMoney(row.scheduledCents)}
      </Td>
      <Td align="right" numeric bold={bold}>
        {formatMoney(row.previouslyBilledCents)}
      </Td>
      <Td align="right" numeric bold={bold}>
        {formatMoney(row.thisPeriodCents)}
      </Td>
      <Td align="right" numeric bold={bold}>
        {formatMoney(row.totalBilledCents)}
      </Td>
      <Td align="right" numeric bold={bold}>
        {formatPercent(row.percentComplete)}
      </Td>
      {/* Overspent reads as a negative balance, flagged the way the dashboard flags it (R3.6). */}
      <Td
        align="right"
        numeric
        bold={bold}
        className={row.balanceCents < 0 ? "text-danger font-bold" : undefined}
      >
        {formatMoney(row.balanceCents)}
      </Td>
    </tr>
  );
}

function ReconciliationRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 px-4 py-3 ${last ? "" : "border-b border-line"}`}
    >
      <span className="text-[15px] text-muted">{label}</span>
      <span className="text-[15px] font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}
