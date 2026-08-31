import "server-only";

/**
 * Capturing a month's budget position when it is submitted (R3.8, D-68).
 *
 * Its own module rather than a helper inside `actions.ts`, which is `"use server"` — every
 * export there becomes a callable endpoint, and this writes financial history.
 *
 * Written inside a `repeatable read` transaction for the same reason the generators use one
 * (D-35): the figures and the rows they are derived from must be one instant, or a save
 * landing mid-capture persists a torn month.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/src/db";
import { loadContractSettings, loadExpenseAmounts, loadLineItemBudgets } from "@/src/db/queries";
import { monthSnapshotTotals, monthSnapshots } from "@/src/db/schema";
import { allLineItemStats } from "@/src/domain/budget-math";
import type { MonthKey } from "@/src/domain/dates";

/**
 * Record where every line item stood at the end of `month`, replacing any previous capture.
 *
 * Replacing rather than appending: re-submitting a corrected month means the corrected packet
 * is now what was sent, so its figures are what the record should hold. The pinned artifact
 * still preserves the earlier bytes (R10.6).
 */
export async function captureMonthSnapshot(orgId: string, month: MonthKey): Promise<void> {
  await db.transaction(
    async (tx) => {
      const [lineItems, amounts, settings] = await Promise.all([
        loadLineItemBudgets(orgId),
        loadExpenseAmounts(orgId, month),
        loadContractSettings(orgId),
      ]);

      const stats = allLineItemStats(lineItems, amounts, month);

      await tx
        .delete(monthSnapshots)
        .where(and(eq(monthSnapshots.orgId, orgId), eq(monthSnapshots.month, month)));

      if (stats.length > 0) {
        await tx.insert(monthSnapshots).values(
          stats.map((stat) => ({
            orgId,
            month,
            lineItemId: stat.lineItem.id,
            lineItemName: stat.lineItem.name,
            scheduledValueCents: stat.lineItem.scheduledValueCents,
            previouslyBilledCents: stat.previouslyBilledCents,
            spentThisMonthCents: stat.spentThisMonthCents,
            totalBilledCents: stat.totalBilledCents,
            remainingCents: stat.remainingCents,
          })),
        );
      }

      await tx
        .insert(monthSnapshotTotals)
        .values({
          orgId,
          month,
          contractValueCents: settings.contractValueCents,
          perfGrantScheduledCents: settings.perfGrantScheduledCents,
          perfGrantBilledCents: settings.perfGrantBilledCents,
          advancesReceivedCents: settings.advancesReceivedCents,
        })
        .onConflictDoUpdate({
          target: [monthSnapshotTotals.orgId, monthSnapshotTotals.month],
          set: {
            contractValueCents: settings.contractValueCents,
            perfGrantScheduledCents: settings.perfGrantScheduledCents,
            perfGrantBilledCents: settings.perfGrantBilledCents,
            advancesReceivedCents: settings.advancesReceivedCents,
            capturedAt: sql`now()`,
          },
        });
    },
    { isolationLevel: "repeatable read" },
  );
}

/**
 * Discard a month's capture.
 *
 * Un-submitting means the month is no longer claimed to have been sent, so keeping figures
 * labelled "as submitted" would assert something untrue. The pinned artifact is untouched —
 * that is the permanent record of bytes actually delivered (R10.6).
 */
export async function discardMonthSnapshot(orgId: string, month: MonthKey): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(monthSnapshots)
      .where(and(eq(monthSnapshots.orgId, orgId), eq(monthSnapshots.month, month)));
    await tx
      .delete(monthSnapshotTotals)
      .where(and(eq(monthSnapshotTotals.orgId, orgId), eq(monthSnapshotTotals.month, month)));
  });
}
