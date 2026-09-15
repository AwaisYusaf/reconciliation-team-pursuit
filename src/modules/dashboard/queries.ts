import "server-only";

/**
 * Dashboard data for one funding source (Phase 5, D-93).
 *
 * Verbatim move of what used to sit inline in `app/r/page.tsx`, so `SourceBudgetSection` can
 * call it once per source with "All" selected — no behaviour change, same order of reads.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/src/db";
import { monthSnapshots } from "@/src/db/schema";
import { loadExpenseAmounts, loadLineItemBudgets } from "@/src/db/queries";
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
