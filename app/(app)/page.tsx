import Link from "next/link";
import { redirect } from "next/navigation";

import { WelcomeBanner } from "@/src/components/app-shell/welcome-banner";
import { buttonClassName } from "@/src/components/ui/button";
import { EmptyState, PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { loadExpenseAmounts, loadLineItemBudgets } from "@/src/db/queries";
import { allLineItemStats } from "@/src/domain/budget-math";
import { monthLabel } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { getSession } from "@/src/services/auth/session";

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

  const rows = allLineItemStats(lineItems, expenses, month);

  return (
    <div>
      <PageTitle className="mb-1.5">Dashboard</PageTitle>
      <Subtext className="mb-[26px]">Budget status for {monthLabel(month)}.</Subtext>

      {!session.welcomeDismissed && <WelcomeBanner />}

      {lineItems.length === 0 ? (
        <EmptyState>
          No line items yet — set up your budget in{" "}
          <Link href="/line-items" className="text-accent underline">
            Line Items
          </Link>
          .
        </EmptyState>
      ) : (
        <>
          <TableCard minWidth={760}>
            <thead>
              <tr>
                <Th sticky>Line Item</Th>
                <Th align="right">Budget</Th>
                <Th align="right">Spent This Month</Th>
                <Th align="right">Total Spent</Th>
                <Th align="right">Remaining</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.lineItem.id}>
                  <Td sticky>{row.lineItem.name}</Td>
                  <Td align="right" numeric>
                    {formatMoney(row.lineItem.scheduledValueCents)}
                  </Td>
                  <Td align="right" numeric>
                    {formatMoney(row.spentThisMonthCents)}
                  </Td>
                  <Td align="right" numeric>
                    {formatMoney(row.totalBilledCents)}
                  </Td>
                  {/* Nearly exhausted or overspent: red on the soft danger background (R3.6). */}
                  <Td
                    align="right"
                    numeric
                    className={row.isLowBudget ? "font-bold text-danger bg-danger-bg" : undefined}
                  >
                    {formatMoney(row.remainingCents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableCard>

          <div className="flex flex-wrap gap-4 mt-6">
            <Link href="/expenses/new" className={buttonClassName("primary")}>
              Add Expense
            </Link>
            <Link href="/packet" className={buttonClassName("secondary")}>
              View Month-End Packet
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
