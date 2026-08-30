import Link from "next/link";
import { redirect } from "next/navigation";

import { DownloadButton } from "@/src/components/ui/download-button";
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
import { loadPacketReadiness } from "@/src/modules/packet/queries";
import { getSession } from "@/src/services/auth/session";

import { MonthDocuments } from "./month-documents";
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

  const month = session.activeMonth;
  const label = monthLabel(month);
  const readiness = await loadPacketReadiness(session.orgId, month);

  const blocked = readiness.blocking.length > 0;
  const nonEmpty = readiness.rows.filter((row) => row.recordCount > 0);

  return (
    <div>
      <PageHeader
        title="Month-End Packet"
        subtext={`Everything the funder receives for ${label}.`}
        actions={
          <SubmittedMarker
            month={month}
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

      {readiness.totalRecords === 0 && (
        <p className="text-[15px] text-muted mb-7">This month has no expenses.</p>
      )}

      {readiness.rows.length === 0 ? (
        <EmptyState>
          No line items yet — set up your budget in{" "}
          <Link href="/line-items" className="text-accent underline">
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
            <ContentsRow
              index={1}
              label="Contract summary sheet"
              pages={readiness.summaryPages}
            />
            <ContentsRow
              index={2}
              label="Expense index"
              pages={readiness.indexPages}
            />
            <ContentsRow
              index={3}
              label="Month documents"
              pages={readiness.monthDocumentPages}
            />
            {nonEmpty.map((row, index) => (
              <ContentsRow
                key={row.lineItemId}
                index={index + 4}
                label={`${row.name} — cover sheet + documents`}
                pages={row.estimatedPages}
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

          <div className="flex flex-wrap gap-3 mt-6">
            <DownloadButton
              href={`/api/downloads/packet?month=${month}`}
              disabled={blocked}
              pendingLabel="Assembling…"
            >
              Download Packet (PDF)
            </DownloadButton>
            <DownloadButton
              href={`/api/downloads/summary?month=${month}`}
              variant="secondary"
              disabled={blocked}
            >
              Download Summary (Excel)
            </DownloadButton>
          </div>
        </Card>

        <MonthDocuments
          month={month}
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
