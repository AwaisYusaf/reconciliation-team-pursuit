import Link from "next/link";
import { redirect } from "next/navigation";

import { PickFundingSource } from "@/src/components/app-shell/pick-funding-source";
import { TourSequenceSkip } from "@/src/components/app-shell/tour-sequence-skip";
import {
  Card,
  CARD_PADDING,
  DangerPanel,
  EmptyState,
  PageHeader,
  SectionTitle,
} from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { TourGuide } from "@/src/components/ui/tour";
import { formatDateUS, monthLabel, todayIso } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { pageTitle, UI } from "@/src/domain/strings";
import { packetContents } from "@/src/generation/packet-order";
import { loadTrashedExpenses } from "@/src/modules/expenses/queries";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadSummaryCard } from "@/src/modules/monthly-summary/queries";
import { loadLockedMonths, loadLockEvents, loadPacketReadiness } from "@/src/modules/packet/queries";
import { PACKET_TOUR_STEPS } from "@/src/modules/tours/packet-tour";
import { hasSeenTour } from "@/src/modules/tours/queries";
import { getSession } from "@/src/services/auth/session";

import { LockHistory, MonthLockControls } from "./month-lock";
import { MonthDocuments } from "./month-documents";
import { MonthlySummaryCard } from "./monthly-summary-card";
import { PacketDownloadButtons, type DeletedItem } from "./packet-download-buttons";

export const metadata = { title: pageTitle("Month-End Packet") };

/**
 * m06 — the month's finish line.
 *
 * Readiness, the blocking list, month documents, the contents the packet will contain, and
 * the two downloads. The page counts come from the same estimator the assembler is
 * calibrated against, so the listing describes the file the user actually receives.
 */
export default async function PacketPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { selectedId: fundingSourceId, activeSources, sources } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );
  const month = session.activeMonth;
  const label = monthLabel(month);

  if (fundingSourceId === null) {
    return (
      <div>
        {/* Nothing here for the packet tour to point at, so a running walkthrough is handed on
            rather than stopping at this screen. The tour itself stays unseen and plays on the
            next visit with a source chosen. */}
        <TourSequenceSkip tour="packet" />
        <PageHeader title="Month-End Packet" subtext={`Everything the funder receives for ${label}.`} />
        <PickFundingSource
          sources={activeSources}
          archivedSources={sources.filter((s) => s.archivedAt !== null)}
        />
      </div>
    );
  }

  const [readiness, deletedInMonth, seenPacketTour, events, lockedMonths, summaryCard] = await Promise.all([
    loadPacketReadiness(session.orgId, fundingSourceId, month),
    loadTrashedExpenses(session.orgId, fundingSourceId, month),
    hasSeenTour(session.userId, "packet"),
    loadLockEvents(session.orgId, fundingSourceId, month),
    loadLockedMonths(session.orgId, fundingSourceId),
    loadSummaryCard(session.orgId, fundingSourceId, month),
  ]);

  // Locked state comes from `month_statuses.locked_at`, not from the newest event (PR #16
  // review): the newest event being a lock does not by itself mean the month is still locked —
  // only `locked_at` is what every write's guard (`monthLocked`) actually checks. The newest
  // event is still used below, for its date/name/link, but only once `locked` says to show it.
  const locked = lockedMonths.has(`${fundingSourceId}:${month}`);
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const lockedEvent =
    locked && lastEvent
      ? {
          id: lastEvent.id,
          // The organisation's calendar date, matching every other date shown on this page.
          date: formatDateUS(todayIso(lastEvent.createdAt)),
          name: lastEvent.userDisplay,
        }
      : null;

  // Archived sources stay selectable so their history and documents remain reachable, which
  // means this page now renders for one — and month documents can't be added to or removed
  // from it (`modules/packet/actions.ts`, `api/files/upload`). Offering those controls anyway
  // meant the only thing an archived source's upload form could produce was an error toast.
  const sourceIsArchived = sources.some((s) => s.id === fundingSourceId && s.archivedAt !== null);
  const blocked = readiness.blocking.length > 0;
  const nonEmpty = readiness.rows.filter((row) => row.recordCount > 0);
  const deletedItems: DeletedItem[] = deletedInMonth.map((expense) => ({
    id: expense.id,
    name: expense.name,
    lineItemName: expense.lineItemName,
    amountCents: expense.amountCents,
    deletedAt: formatDateUS(todayIso(expense.deletedAt)),
  }));

  return (
    <div>
      {/* Only ever mounted here, on the branch that resolved an actual single source — the
          PickFundingSource branch above returns before this point, so "don't start the tour
          until a source is chosen" (spec) needs no separate check. */}
      <TourGuide tour="packet" steps={PACKET_TOUR_STEPS} alreadySeen={seenPacketTour} />
      <PageHeader
        title="Month-End Packet"
        subtext={`Everything the funder receives for ${label}.`}
        actions={
          <MonthLockControls
            month={month}
            monthLabel={label}
            fundingSourceId={fundingSourceId}
            // The organisation's calendar date, not UTC's: a packet submitted at 9 pm in
            // Detroit would otherwise be stamped with tomorrow's date (R2.5, D-26).
            submittedAt={
              readiness.submittedAt ? formatDateUS(todayIso(readiness.submittedAt)) : null
            }
            locked={locked}
            lockedEvent={lockedEvent}
            blocked={blocked}
          />
        }
      />

      <LockHistory events={events} />

      {/* The tour wrapper below is the same width as the panel inside it: the spotlight lights
          that element's box, so a full-width wrapper around a narrower panel lit a wide empty
          strip beside it. */}
      {blocked && (
        <div data-tour="packet-blocking-alert" className="max-w-[820px]">
          <DangerPanel title={UI.blockedTitle} className="mb-7 max-w-[820px]">
            <p className="mt-1.5">{UI.blockedIntro}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {readiness.blocking.map((record) => (
                <li key={record.expenseId} className="flex flex-wrap items-baseline gap-2">
                  <span>{record.label}</span>
                  <Link
                    href={`/r/expenses/${record.expenseId}/edit`}
                    className="underline text-danger font-medium"
                  >
                    Open expense
                  </Link>
                </li>
              ))}
            </ul>
          </DangerPanel>
        </div>
      )}

      {readiness.totalRecords === 0 && (
        <p className="text-[15px] text-muted mb-7">This month has no expenses.</p>
      )}

      {readiness.rows.length === 0 ? (
        <EmptyState>
          No line items yet — set up your budget in{" "}
          <Link href="/r/line-items" className="text-accent underline">
            Line Items
          </Link>
          .
        </EmptyState>
      ) : (
        <TableCard minWidth={660}>
          <thead>
            <tr>
              <Th sticky>Line Item</Th>
              <Th align="right">Amount This Month</Th>
              <Th align="right">Records</Th>
              <Th align="right" data-tour="packet-doc-complete">
                Documentation Complete
              </Th>
            </tr>
          </thead>
          <tbody>
            {readiness.rows.map((row) => (
              <tr key={row.lineItemId}>
                <Td sticky>{row.name}</Td>
                <Td align="right" numeric>
                  {formatMoney(row.amountCents)}
                </Td>
                <Td align="right" numeric>
                  {row.recordCount}
                </Td>
                {/* A line item with no records is neither ready nor blocking — it shows "—". */}
                <Td
                  align="right"
                  className={row.complete === false ? "font-bold text-danger" : undefined}
                >
                  {row.complete === null ? "—" : row.complete ? "Yes" : "No"}
                </Td>
              </tr>
            ))}
            <tr>
              <Td bold sticky>Grand Total</Td>
              <Td align="right" numeric bold>
                {formatMoney(readiness.totalAmountCents)}
              </Td>
              <Td align="right" numeric bold>
                {readiness.totalRecords}
              </Td>
              <Td align="right" />
            </tr>
          </tbody>
        </TableCard>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <Card className={CARD_PADDING}>
          <SectionTitle className="mb-1">Packet contents</SectionTitle>
          <p className="text-sm text-muted mb-4">In the order the funder will read them.</p>

          <ol className="flex flex-col divide-y divide-line border-t border-line">
            {/*
              Rendered from `packetContents`, which is the same declaration `buildPacketPdf`
              assembles in (R11.2). This list used to be a second hand-written sequence, so the
              caption above could promise an order the file did not have.
            */}
            {packetContents({
              summaryPages: readiness.summaryPages,
              indexPages: readiness.indexPages,
              monthDocumentPages: readiness.monthDocumentPages,
              lineItems: nonEmpty,
            }).map((section, index) => (
              <ContentsRow
                key={section.key}
                index={index + 1}
                label={section.label}
                pages={section.pages}
              />
            ))}
          </ol>

          <div className="flex items-baseline justify-between pt-3 mt-1 border-t-2 border-ink">
            <span className="text-[15px] font-bold text-ink">Total</span>
            <span className="text-[15px] font-bold tabular-nums text-ink">
              {readiness.totalPages} pages
            </span>
          </div>
          <p className="text-[13px] text-muted mt-2">
            Page counts are estimated within about two pages of the final document.
          </p>

          <PacketDownloadButtons
            month={month}
            fundingSourceId={fundingSourceId}
            blocked={blocked}
            deletedItems={deletedItems}
            locked={locked}
          />
        </Card>

        {/* Matches the Card's own width inside `MonthDocuments` — same reason as above. */}
        <div data-tour="packet-month-documents" className="max-w-[720px]">
          <MonthDocuments
            month={month}
            fundingSourceId={fundingSourceId}
            documents={readiness.documents}
            monthLabel={label}
            hasBankStatement={readiness.hasBankStatement}
            readOnly={sourceIsArchived || locked}
            lockedMessage={locked ? UI.monthLocked(label) : null}
          />
        </div>
      </div>

      <MonthlySummaryCard card={summaryCard ?? { use: false, writtenAt: null }} monthLabel={label} />
    </div>
  );
}

function ContentsRow({
  index,
  label,
  pages,
}: {
  index: number;
  label: string;
  pages: number;
}) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="text-[15px] text-ink">
        {index}. {label}
      </span>
      <span className="text-[15px] text-muted tabular-nums whitespace-nowrap">
        {pages} {pages === 1 ? "page" : "pages"}
      </span>
    </li>
  );
}
