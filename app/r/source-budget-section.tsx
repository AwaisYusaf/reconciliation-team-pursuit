import Link from "next/link";

import { buttonClassName } from "@/src/components/ui/button";
import { StatTile } from "@/src/components/ui/stat-tile";
import {
  Card,
  DangerPanel,
  EmptyState,
  GRADIENT_TEXT,
  SectionTitle,
  Subtext,
} from "@/src/components/ui/surfaces";
import { cn } from "@/src/lib/cn";
import { TableCard, Td, Th, Tr } from "@/src/components/ui/table";
import type { FundingSource } from "@/src/db/schema";
import { monthLabel, monthShortLabel, type MonthKey } from "@/src/domain/dates";
import { formatMoney, formatPercent } from "@/src/domain/format";
import { documentationStatus } from "@/src/domain/gate";
import { loadSourceBudget, loadYearSpend } from "@/src/modules/dashboard/queries";
import { loadMonthExpenses } from "@/src/modules/expenses/queries";
import { HeroCard, HeroMoney, HeroPill, SpendChart } from "./dashboard-hero";
import { MonthlySummaryReadyLink } from "./monthly-summary-ready-link";
import { RecentExpenses } from "./recent-expenses";

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
  summaryReady,
  selectedId,
}: {
  orgId: string;
  source: FundingSource;
  month: MonthKey;
  showTitle: boolean;
  summaryReady: boolean;
  selectedId: string | null;
}) {
  const { lineItems, stats, positions, grant, drift } = await loadSourceBudget(
    orgId,
    source.id,
    month,
  );
  // Both are reads, and both are scoped to this one source, so they join the existing
  // per-source load rather than adding a pass over the organisation.
  const [yearSpend, monthExpenses] = await Promise.all([
    loadYearSpend(orgId, source.id, Number(month.slice(0, 4))),
    loadMonthExpenses(orgId, source.id, month),
  ]);

  const incompleteCount = monthExpenses.filter(
    (expense) =>
      documentationStatus({
        id: expense.id,
        name: expense.name,
        lineItemName: expense.lineItemName,
        noReceipt: expense.noReceipt,
        hasNarrative: Boolean(expense.narrative?.trim()),
        documents: expense.documents,
      }).missing !== null,
  ).length;
  const spentThisMonthCents = positions.reduce((total, row) => total + row.thisMonthCents, 0);
  const overspentCount = positions.filter((row) => row.closingCents < 0).length;

  return (
    <section className={showTitle ? "mb-10" : undefined}>
      {showTitle && <SectionTitle className="mb-4">{source.name}</SectionTitle>}

      {drift.length > 0 && (
        <DangerPanel tone="notice" className="mb-6">
          <div className="font-semibold mb-1.5">
            {monthLabel(month)} has changed since it was submitted.
          </div>
          <div className="text-[15px] leading-relaxed">
            The packet that was sent is unchanged and still downloadable. These line items now
            differ from it:
          </div>
          <ul className="mt-2.5 flex flex-col gap-2 text-[15px] tabular-nums">
            {drift.map((row) => (
              <li key={row.name}>
                <span className="font-semibold">{row.name}</span>
                <ul className="ml-4 mt-0.5 flex flex-col gap-0.5">
                  {row.changes.map((change) => (
                    <li key={change.field}>
                      {DRIFT_LABEL[change.field]}: submitted at{" "}
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

      {lineItems.length === 0 ? (
        <EmptyState>
          No line items yet. Set up your budget in{" "}
          <Link href="/r/line-items" className="text-accent underline">
            Line Items
          </Link>
          .
        </EmptyState>
      ) : (
        <>
          {/* The position, the year it sits in, and the counts for the month. */}
          <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr] mb-3">
            <HeroCard
              title="Total remaining"
              action={
                <HeroPill>
                  {formatPercent(grant.percentComplete)} committed
                </HeroPill>
              }
            >
              <HeroMoney cents={grant.remainingCents} />
              <p className="text-[13px] text-sub mt-2 mb-0 leading-snug max-w-[46ch]">
                This funding source to date, across every month.
              </p>
              <SpendChart series={yearSpend} activeMonth={month} />
            </HeroCard>

            {/*
              Six figures, one of them filled. `Spent this month` takes the accent because it
              is the only one that answers "what did we just do", which is what somebody
              opening the dashboard mid-month came to see.
            */}
            <div className="grid grid-cols-2 gap-3 content-start">
              <StatTile
                label="Spent this month"
                value={formatMoney(spentThisMonthCents)}
                tone="accent"
              />
              <StatTile
                label={`Expenses in ${monthShortLabel(month)}`}
                value={monthExpenses.length}
              />
              <StatTile
                label="Original approved budget"
                value={formatMoney(grant.approvedCents)}
              />
              <StatTile
                label="Total spent to date"
                value={formatMoney(grant.spentToDateCents)}
              />
              <StatTile
                label="Missing documents"
                value={incompleteCount}
                tone={incompleteCount > 0 ? "danger" : "default"}
                sub={
                  incompleteCount > 0 ? (
                    <Link href="/r/packet" className="text-accent underline">
                      These block the packet
                    </Link>
                  ) : (
                    "All documented."
                  )
                }
              />
              <StatTile
                label="Line items over budget"
                value={overspentCount}
                tone={overspentCount > 0 ? "danger" : "default"}
                sub={overspentCount > 0 ? "Closing balance is negative." : undefined}
              />
            </div>
          </div>

          {/*
            The screen's actions, on the page rather than inside a card.

            These two carry the dashboard's gradient treatment; the shared `Button` does not, so
            the rest of the app's buttons are untouched. The primary takes it as a fill, the
            secondary as gradient text — on a span, because clipping a gradient to text clips
            the button's white background with it and the outline button would come out hollow.

            The primary's label stays solid white. A gradient on white type over a dark fill has
            nowhere to go but darker, which is contrast spent on decoration.
          */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <Link
              href="/r/expenses/new"
              data-tour="dashboard-add-expense"
              className={buttonClassName(
                "primary",
                cn(
                  "bg-[linear-gradient(145deg,var(--color-accent)_0%,var(--color-accent-dark)_100%)]",
                  "hover:bg-[linear-gradient(145deg,var(--color-accent-dark)_0%,#2b1a10_100%)]",
                  "shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]",
                ),
              )}
            >
              Add Expense
            </Link>
            <Link href="/r/packet" className={buttonClassName("secondary")}>
              <span className={GRADIENT_TEXT}>View Month-End Packet</span>
            </Link>
            {summaryReady && (
              <MonthlySummaryReadyLink sourceId={source.id} selectedId={selectedId} />
            )}
          </div>

          {/* What was entered lately, and where each line item stands. */}
          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr] mb-8">
            <RecentExpenses expenses={monthExpenses} month={month} />

            {/*
              Every line item, not a top handful: the table below is the full record and this
              is the same set read at a glance, so quietly capping it would make the two
              disagree about how many line items the funding source has.
            */}
            <div className="grid gap-2 sm:grid-cols-2 content-start">
              {positions.map((row, index) => (
                <StatTile
                  key={row.lineItemId}
                  label={row.name}
                  value={formatMoney(row.closingCents)}
                  tone={stats[index].isLowBudget ? "danger" : "default"}
                  sub={`${formatMoney(row.thisMonthCents)} this month`}
                />
              ))}
            </div>
          </div>

          <div className="font-serif text-lg sm:text-xl font-bold text-ink mb-1">
            {monthLabel(month)} on its own
          </div>
          <Subtext className="mb-3.5 max-w-[70ch]">
            Opening balance, what this month spent, and what is left at the end of it. Each
            month starts where the last one closed.
          </Subtext>

          {/*
            The tour anchor sits on the wrapper, not on the Closing Balance header.

            The same figures render two ways below and only one is ever on screen, so anchoring
            the walkthrough to either would point it at a hidden element at the other width.
            The wrapper is the one node present at both.
          */}
          <div data-tour="dashboard-closing-balance">
            {/*
              A phone gets the same rows stacked, not the table scrolled sideways.

              Four columns need about 700px however tightly they are set, so on a 390px screen
              the table showed the line item and half of one money column, with the header
              clipped mid-word and the rest reachable only by a sideways drag inside the card.
              Stacked, every figure is on screen and labelled, and nothing scrolls.
            */}
            <Card className="lg:hidden divide-y divide-line">
              {positions.map((row, index) => (
                <div
                  key={row.lineItemId}
                  className={cn("px-4 py-3", stats[index].isLowBudget && "bg-danger-bg")}
                >
                  <div className="font-bold text-[15px] text-ink mb-2">{row.name}</div>
                  <dl className="grid grid-cols-3 gap-2 m-0">
                    {(
                      [
                        ["Opening", row.openingCents, false],
                        [`Spent in ${monthShortLabel(month)}`, row.thisMonthCents, false],
                        ["Closing", row.closingCents, stats[index].isLowBudget],
                      ] as const
                    ).map(([label, cents, flagged]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-[0.06em] text-sub font-bold truncate">
                          {label}
                        </dt>
                        <dd
                          // `break-words`: a third of a 390px screen is about 100px, and this
                          // product's figures genuinely reach nine digits. Wrapping is ugly on
                          // those; running into the next column is worse.
                          className={cn(
                            "m-0 mt-0.5 text-[14px] tabular-nums break-words",
                            flagged ? "font-bold text-danger" : "text-ink",
                          )}
                        >
                          {formatMoney(cents)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </Card>

            <TableCard minWidth={760} className="hidden lg:block">
            <thead>
              <tr>
                <Th sticky>Line Item</Th>
                <Th align="right">Opening Balance</Th>
                <Th align="right">Spent in {monthShortLabel(month)}</Th>
                <Th align="right">Closing Balance</Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((row, index) => (
                <Tr
                  key={row.lineItemId}
                  // Nearly exhausted or overspent: the whole row is tinted, not just its last
                  // cell (R3.6). Tinting one cell put a block of colour on the right edge of
                  // the table that belonged to no row in particular.
                  tone={stats[index].isLowBudget ? "danger" : undefined}
                >
                  {/*
                    The pinned cell needs no tint of its own. It is opaque so the scrolling
                    columns pass under it rather than through it, and it fills from `--row-bg`,
                    which `tone` above sets for the whole row — so it matches by construction
                    instead of by a second copy of the same condition.
                  */}
                  <Td sticky>{row.name}</Td>
                  <Td align="right" numeric>
                    {formatMoney(row.openingCents)}
                  </Td>
                  <Td align="right" numeric>
                    {formatMoney(row.thisMonthCents)}
                  </Td>
                  <Td
                    align="right"
                    numeric
                    className={stats[index].isLowBudget ? "font-bold text-danger" : undefined}
                  >
                    {formatMoney(row.closingCents)}
                  </Td>
                </Tr>
              ))}
            </tbody>
            </TableCard>
          </div>
        </>
      )}
    </section>
  );
}
