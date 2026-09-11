import Link from "next/link";
import { redirect } from "next/navigation";

import { PickFundingSource } from "@/src/components/app-shell/pick-funding-source";
import {
  Card,
  CARD_PADDING,
  DangerPanel,
  EmptyState,
  PageHeader,
  SectionTitle,
} from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatDateUS, monthLabel, todayIso } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { UI } from "@/src/domain/strings";
import { packetContents } from "@/src/generation/packet-order";
import { loadTrashedExpenses } from "@/src/modules/expenses/queries";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadPacketReadiness } from "@/src/modules/packet/queries";
import { getSession } from "@/src/services/auth/session";

import { MonthDocuments } from "./month-documents";
import { PacketDownloadButtons, type DeletedItem } from "./packet-download-buttons";
import { SubmittedMarker } from "./submitted-marker";

export const metadata = { title: "Month-End Packet — Grant Expense Reconciliation" };

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

  const { selectedId: fundingSourceId, activeSources } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );
  const month = session.activeMonth;
  const label = monthLabel(month);

  if (fundingSourceId === null) {
    return (
      <div>
        <PageHeader title="Month-End Packet" subtext={`Everything the funder receives for ${label}.`} />
        <PickFundingSource sources={activeSources} />
      </div>
    );
  }

  const [readiness, deletedInMonth] = await Promise.all([
    loadPacketReadiness(session.orgId, fundingSourceId, month),
    loadTrashedExpenses(session.orgId, fundingSourceId, month),
  ]);

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
      <PageHeader
        title="Month-End Packet"
        subtext={`Everything the funder receives for ${label}.`}
        actions={
          <SubmittedMarker
            month={month}
            fundingSourceId={fundingSourceId}
            // The organisation's calendar date, not UTC's: a packet submitted at 9 pm in
            // Detroit would otherwise be stamped with tomorrow's date (R2.5, D-26).
            submittedAt={
              readiness.submittedAt ? formatDateUS(todayIso(readiness.submittedAt)) : null
            }
          />
        }
      />

      {blocked && (
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
              <Th align="right">Documentation Complete</Th>
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
          />
        </Card>

        <MonthDocuments
          month={month}
          fundingSourceId={fundingSourceId}
          documents={readiness.documents}
          monthLabel={label}
          hasBankStatement={readiness.hasBankStatement}
        />
      </div>
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
