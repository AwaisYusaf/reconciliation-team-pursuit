import "server-only";

/**
 * Dashboard data for one funding source (Phase 5, D-93).
 *
 * Verbatim move of what used to sit inline in `app/r/page.tsx`, so `SourceBudgetSection` can
 * call it once per source with "All" selected — no behaviour change, same order of reads.
 */
import { and, eq, gte, isNull, lte } from "drizzle-orm";

import { db } from "@/src/db";
import { expenses as expensesTable, monthSnapshots } from "@/src/db/schema";
import { loadExpenseAmounts, loadLineItemBudgets } from "@/src/db/queries";
import { reimbursableCents } from "@/src/domain/money";
import { monthShortLabel } from "@/src/domain/dates";
import {
  allLineItemStats,
  grantPosition,
  monthPositions,
  snapshotDrift,
  type GrantPosition,
  type LineItemBudget,
  type LineItemStats,
  type MonthPosition,
  type SnapshotDrift,
} from "@/src/domain/budget-math";
import type { MonthKey } from "@/src/domain/dates";

export type SourceBudget = {
  lineItems: LineItemBudget[];
  stats: LineItemStats[];
  positions: MonthPosition[];
  grant: GrantPosition;
  drift: SnapshotDrift[];
};

export async function loadSourceBudget(
  orgId: string,
  fundingSourceId: string,
  month: MonthKey,
): Promise<SourceBudget> {
  const [lineItems, expenses] = await Promise.all([
    loadLineItemBudgets(orgId, fundingSourceId),
    loadExpenseAmounts(orgId, fundingSourceId, month),
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
    .where(
      and(
        eq(monthSnapshots.orgId, orgId),
        eq(monthSnapshots.fundingSourceId, fundingSourceId),
        eq(monthSnapshots.month, month),
      ),
    );

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

  return { lineItems, stats, positions, grant, drift };
}

export type MonthSpend = {
  month: MonthKey;
  /** `Jan`, `Feb` … for the chart's axis. */
  label: string;
  spentCents: number;
};

/**
 * Reimbursable spend for each of the twelve months of `year`, for the dashboard's chart.
 *
 * Read-only, and deliberately not a `SUM()` in SQL. Whether tax and fees count towards a
 * figure is a per-expense decision (R1.3), so summing the columns in the database would mean
 * restating that rule in SQL, where it could drift from `reimbursableCents`. Every other
 * total in the app comes from that one function, and a chart that quietly used a second
 * definition would be the exact disagreement R10.2 exists to prevent. The rows are one
 * organisation's one funding source for one year, so the cost of summing them here is
 * nothing.
 *
 * Returns all twelve months whether or not they hold expenses, so the axis is a full year and
 * a month with no spending reads as an empty column rather than as a missing one. Deleted
 * expenses are excluded, and drafts never appear because they live in their own table until
 * they are approved (D-115).
 */
export async function loadYearSpend(
  orgId: string,
  fundingSourceId: string,
  year: number,
): Promise<MonthSpend[]> {
  const rows = await db
    .select({
      month: expensesTable.month,
      subtotalCents: expensesTable.subtotalCents,
      taxCents: expensesTable.taxCents,
      feesCents: expensesTable.feesCents,
      taxReimbursable: expensesTable.taxReimbursable,
      feesReimbursable: expensesTable.feesReimbursable,
    })
    .from(expensesTable)
    .where(
      and(
        eq(expensesTable.orgId, orgId),
        eq(expensesTable.fundingSourceId, fundingSourceId),
        // `month` is a fixed-width `YYYY-MM` char column, so a string range is a calendar
        // range and needs no date parsing.
        gte(expensesTable.month, `${year}-01`),
        lte(expensesTable.month, `${year}-12`),
        isNull(expensesTable.deletedAt),
      ),
    );

  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.month, (totals.get(row.month) ?? 0) + reimbursableCents(row));
  }

  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    return { month, label: monthShortLabel(month), spentCents: totals.get(month) ?? 0 };
  });
}
