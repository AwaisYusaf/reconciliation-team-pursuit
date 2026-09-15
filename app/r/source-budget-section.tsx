import Link from "next/link";

import { buttonClassName } from "@/src/components/ui/button";
import { DangerPanel, EmptyState, SectionTitle, Subtext } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import type { FundingSource } from "@/src/db/schema";
import { monthLabel, monthShortLabel, type MonthKey } from "@/src/domain/dates";
import { formatMoney, formatPercent } from "@/src/domain/format";
import { loadSourceBudget } from "@/src/modules/dashboard/queries";

/** Wording for each figure the drift notice can report (R3.8). */
const DRIFT_LABEL: Record<"opening" | "spent" | "closing", string> = {
  opening: "Opening balance",
  spent: "Spent this month",
  closing: "Closing balance",
};

/**
 * m01 — budget status per line item for one funding source, for the active month.
 *
 * Every figure comes from the shared calculation service, so this table and the contract
 * summary can never disagree (R10.2). Rendered once per source so "All" can show every
 * source's own section, with no combined total across them (Appendix A §5).
 */
export async function SourceBudgetSection({
  orgId,
  source,
  month,
  showTitle,
}: {
  orgId: string;
  source: FundingSource;
  month: MonthKey;
  showTitle: boolean;
}) {
  const { lineItems, stats, positions, grant, drift } = await loadSourceBudget(orgId, source.id, month);

  return (
    <section className={showTitle ? "mb-10" : undefined}>
      {showTitle && <SectionTitle className="mb-3">{source.name}</SectionTitle>}

      {drift.length > 0 && (
        <DangerPanel tone="notice" className="mb-6">
          <div className="font-semibold mb-1.5">
            {monthLabel(month)} has changed since it was submitted.
          </div>
          <div className="text-[15px] leading-relaxed">
            The packet that was sent is unchanged and still downloadable. These categories now
            differ from it:
          </div>
          <ul className="mt-2.5 flex flex-col gap-2 text-[15px] tabular-nums">
            {drift.map((row) => (
              <li key={row.name}>
                <span className="font-semibold">{row.name}</span>
                <ul className="ml-4 mt-0.5 flex flex-col gap-0.5">
                  {row.changes.map((change) => (
                    <li key={change.field}>
                      {DRIFT_LABEL[change.field]} — submitted at{" "}
                      {formatMoney(change.submittedCents)}, now{" "}
                      {formatMoney(change.currentCents)} (
                      {change.differenceCents > 0 ? "+" : ""}
                      {formatMoney(change.differenceCents)})
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </DangerPanel>
      )}

      {lineItems.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3 mb-7">
          {(
            [
              ["Original approved budget", grant.approvedCents, false],
              ["Total spent to date", grant.spentToDateCents, false],
              ["Total remaining", grant.remainingCents, grant.remainingCents < 0],
            ] as const
          ).map(([label, cents, negative]) => (
            <div key={label} className="border border-line rounded-[3px] bg-surface px-5 py-4">
              <div className="text-[13px] uppercase tracking-[0.04em] text-sub">{label}</div>
              <div
                className={`text-2xl font-bold tabular-nums mt-1.5 ${negative ? "text-danger" : "text-ink"}`}
              >
                {formatMoney(cents)}
              </div>
            </div>
          ))}
          <div className="sm:col-span-3 text-[15px] text-sub">
            The whole grant to date, across every month — {formatPercent(grant.percentComplete)}{" "}
            of the approved budget committed.
          </div>
        </div>
      )}

      {lineItems.length === 0 ? (
        <EmptyState>
          No line items yet — set up your budget in{" "}
          <Link href="/r/line-items" className="text-accent underline">
            Line Items
          </Link>
          .
        </EmptyState>
      ) : (
        <>
          <div className="font-serif text-lg font-bold text-ink mb-1">
            {monthLabel(month)} on its own
          </div>
          <Subtext className="mb-3.5 max-w-[70ch]">
            Opening balance, what this month spent, and what is left at the end of it. Each
            month starts where the last one closed.
          </Subtext>

          <TableCard minWidth={760}>
            <thead>
              <tr>
                <Th sticky>Line Item</Th>
                <Th align="right">Opening Balance</Th>
                <Th align="right">Spent in {monthShortLabel(month)}</Th>
                <Th align="right" data-tour="dashboard-closing-balance">
                  Closing Balance
                </Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((row, index) => (
                <tr key={row.lineItemId}>
                  <Td sticky>{row.name}</Td>
                  <Td align="right" numeric>
                    {formatMoney(row.openingCents)}
                  </Td>
                  <Td align="right" numeric>
                    {formatMoney(row.thisMonthCents)}
                  </Td>
                  {/* Nearly exhausted or overspent: red on the soft danger background (R3.6). */}
                  <Td
                    align="right"
                    numeric
                    className={
                      stats[index].isLowBudget ? "font-bold text-danger bg-danger-bg" : undefined
                    }
                  >
                    {formatMoney(row.closingCents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableCard>

          <div className="flex flex-wrap gap-4 mt-6">
            <Link href="/r/expenses/new" className={buttonClassName("primary")}>
              Add Expense
            </Link>
            <Link href="/r/packet" className={buttonClassName("secondary")}>
              View Month-End Packet
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
