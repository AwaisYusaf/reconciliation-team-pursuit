import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { WelcomeBanner } from "@/src/components/app-shell/welcome-banner";
import { buttonClassName } from "@/src/components/ui/button";
import { DangerPanel, EmptyState, PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { db } from "@/src/db";
import { monthSnapshots } from "@/src/db/schema";
import { loadExpenseAmounts, loadLineItemBudgets } from "@/src/db/queries";
import { allLineItemStats, grantPosition, monthPositions, snapshotDrift } from "@/src/domain/budget-math";
import { monthLabel, monthShortLabel } from "@/src/domain/dates";
import { formatMoney, formatPercent } from "@/src/domain/format";
import { getSession } from "@/src/services/auth/session";

/** Wording for each figure the drift notice can report (R3.8). */
const DRIFT_LABEL: Record<"opening" | "spent" | "closing", string> = {
  opening: "Opening balance",
  spent: "Spent this month",
  closing: "Closing balance",
};

export const metadata = { title: "Dashboard — Grant Expense Reconciliation" };

/**
 * m01 — budget status per line item for the active month.
 *
 * Every figure comes from the shared calculation service, so this table and the contract
 * summary can never disagree (R10.2).
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const month = session.activeMonth;
  const [lineItems, expenses] = await Promise.all([
    loadLineItemBudgets(session.orgId),
    loadExpenseAmounts(session.orgId, month),
  ]);

  // What this month was submitted as, if it was. Present only for a submitted month (D-68).
  const submitted = await db
    .select({
      lineItemId: monthSnapshots.lineItemId,
      lineItemName: monthSnapshots.lineItemName,
      // The whole position, not just the spend: a budget edit moves opening and closing
      // while leaving the month's own spend untouched (D-72).
      scheduledValueCents: monthSnapshots.scheduledValueCents,
      previouslyBilledCents: monthSnapshots.previouslyBilledCents,
      spentThisMonthCents: monthSnapshots.spentThisMonthCents,
      remainingCents: monthSnapshots.remainingCents,
    })
    .from(monthSnapshots)
    .where(and(eq(monthSnapshots.orgId, session.orgId), eq(monthSnapshots.month, month)));

  const stats = allLineItemStats(lineItems, expenses, month);
  // Two views, deliberately not one table (R3.8): the month on its own, and the grant to
  // date. Mixing monthly activity with the running total is what made May's figures look
  // like they rolled into June.
  const positions = monthPositions(stats);
  const grant = grantPosition(stats);
  // Both figures are true: one is what was sent, the other what is now known. A silent
  // divergence between a submitted packet and this screen is what could not be seen before.
  // The snapshot stores what R3.1–R3.4 define; the month view states the same position as
  // budget remaining (R3.8), so it is converted here rather than stored twice.
  const submittedPositions = submitted.map((row) => ({
    lineItemId: row.lineItemId,
    lineItemName: row.lineItemName,
    openingCents: row.scheduledValueCents - row.previouslyBilledCents,
    spentThisMonthCents: row.spentThisMonthCents,
    closingCents: row.remainingCents,
  }));
  const drift = submitted.length > 0 ? snapshotDrift(submittedPositions, positions) : [];

  return (
    <div>
      <PageTitle className="mb-1.5">Dashboard</PageTitle>
      <Subtext className="mb-[26px]">Budget status for {monthLabel(month)}.</Subtext>

      {!session.welcomeDismissed && <WelcomeBanner />}

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
                <Th align="right">Closing Balance</Th>
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
    </div>
  );
}
