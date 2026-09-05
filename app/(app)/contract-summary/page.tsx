import Link from "next/link";
import { redirect } from "next/navigation";

import { DownloadButton } from "@/src/components/ui/download-button";
import { Card, EmptyState, PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { SectionRow, TableCard, Td, Th } from "@/src/components/ui/table";
import { loadContractSettings, loadExpenseAmounts, loadLineItemBudgets } from "@/src/db/queries";
import { db } from "@/src/db";
import { contractSettings } from "@/src/db/schema";
import { contractContextItems } from "@/src/domain/contract-context";
import { monthLabel } from "@/src/domain/dates";
import { formatMoney, formatPercent } from "@/src/domain/format";
import { blockingRecords, type GateExpense } from "@/src/domain/gate";
import { downloadBlockedReason } from "@/src/domain/strings";
import { contractSummary, type SummaryRow } from "@/src/domain/summary";
import { loadMonthExpenses } from "@/src/modules/expenses/queries";
import { getSession } from "@/src/services/auth/session";
import { eq } from "drizzle-orm";

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

  const month = session.activeMonth;
  const [lineItems, amounts, settings, identifiers, monthExpenses] = await Promise.all([
    loadLineItemBudgets(session.orgId),
    loadExpenseAmounts(session.orgId, month),
    loadContractSettings(session.orgId),
    db
      .select({
        contractNumber: contractSettings.contractNumber,
        basePoNumber: contractSettings.basePoNumber,
        performancePoNumber: contractSettings.performancePoNumber,
      })
      .from(contractSettings)
      .where(eq(contractSettings.orgId, session.orgId))
      .limit(1),
    loadMonthExpenses(session.orgId, month),
  ]);

  if (lineItems.length === 0) {
    return (
      <div>
        <PageTitle className="mb-1.5">Contract Summary</PageTitle>
        <Subtext className="mb-[26px]">Contract position for {monthLabel(month)}.</Subtext>
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

  const summary = contractSummary({ lineItems, expenses: amounts, settings, month });

  const context = contractContextItems(
    {
      contractNumber: identifiers[0]?.contractNumber ?? "",
      basePoNumber: identifiers[0]?.basePoNumber ?? "",
      performancePoNumber: identifiers[0]?.performancePoNumber ?? "",
      contractValueCents: settings.contractValueCents,
      scheduledTotalCents: summary.totals.scheduledCents,
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
      <PageTitle className="mb-1.5">Contract Summary</PageTitle>
      <Subtext className="mb-3.5">Contract position for {monthLabel(month)}.</Subtext>

      <div className="flex flex-wrap gap-x-8 gap-y-1.5 text-base text-muted mb-[26px]">
        {context.map((item) => (
          <span key={item.label}>{item.text}</span>
        ))}
      </div>

      <TableCard minWidth={900}>
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
          <SummaryTableRow row={summary.totals} bold />
        </tbody>
      </TableCard>

      <Card className="max-w-[460px] mt-7">
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
          href={`/api/downloads/summary?month=${month}`}
          disabled={refusal !== null}
        >
          Download Summary (Excel)
        </DownloadButton>
        {refusal && <p className="mt-2.5 text-sm text-danger">{refusal}</p>}
      </div>
    </div>
  );
}

function SummaryTableRow({ row, bold = false }: { row: SummaryRow; bold?: boolean }) {
  return (
    <tr>
      <Td bold={bold} sticky>{row.name}</Td>
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
