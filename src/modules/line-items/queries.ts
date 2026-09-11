import "server-only";

/**
 * Line item reads for m08, including the usage counts the delete rules need (R9.3).
 */
import { and, asc, count, eq } from "drizzle-orm";

import { db } from "@/src/db";
import { expenses, lineItemPerformances, lineItems, recurringItems } from "@/src/db/schema";

/** `name`/`date` are null for a performance that predates those columns (D-92) — rendered
 *  as a positional fallback and a blank date, never guessed. */
export type LineItemPerformanceRow = {
  id: string;
  amountCents: number;
  name: string | null;
  date: string | null;
  /** True for a performance already inside the org's contract value (`countsTowardContractTotal`
   *  false — the migrated Performance Grant). Its amount can't be edited: a boolean flag can't
   *  express "only the delta is new money", so an edit would make the contract total and the
   *  sum of scheduled values disagree. Delete and re-add to change it (D-92). */
  amountLocked: boolean;
};

export type LineItemRow = {
  id: string;
  name: string;
  /** The base value — what the inline Edit form edits. */
  scheduledValueCents: number;
  /** Base + every performance added on top (m08) — what the rest of the app now computes with. */
  totalScheduledValueCents: number;
  performances: LineItemPerformanceRow[];
  openingBilledCents: number;
  sortOrder: number;
  /** Expenses in any month; a non-zero count blocks deletion outright. */
  expenseCount: number;
  /** Recurring items are cascade-deleted after a confirmation that lists them. */
  recurringNames: string[];
};

export async function loadLineItemRows(orgId: string): Promise<LineItemRow[]> {
  const [items, expenseCounts, recurring, performances] = await Promise.all([
    db
      .select()
      .from(lineItems)
      .where(eq(lineItems.orgId, orgId))
      .orderBy(asc(lineItems.sortOrder), asc(lineItems.name)),
    // Not filtered on `deletedAt`: must agree with the delete gate in
    // line-items/actions.ts, or this screen would say "0 expenses" while delete refuses.
    db
      .select({ lineItemId: expenses.lineItemId, total: count() })
      .from(expenses)
      .where(eq(expenses.orgId, orgId))
      .groupBy(expenses.lineItemId),
    db
      .select({ lineItemId: recurringItems.lineItemId, name: recurringItems.name })
      .from(recurringItems)
      .where(eq(recurringItems.orgId, orgId))
      .orderBy(asc(recurringItems.sortOrder)),
    db
      .select({
        id: lineItemPerformances.id,
        lineItemId: lineItemPerformances.lineItemId,
        amountCents: lineItemPerformances.amountCents,
        name: lineItemPerformances.name,
        date: lineItemPerformances.date,
        countsTowardContractTotal: lineItemPerformances.countsTowardContractTotal,
      })
      .from(lineItemPerformances)
      .where(eq(lineItemPerformances.orgId, orgId))
      .orderBy(asc(lineItemPerformances.sortOrder)),
  ]);

  const countByLineItem = new Map(expenseCounts.map((row) => [row.lineItemId, row.total]));
  const recurringByLineItem = new Map<string, string[]>();
  for (const row of recurring) {
    const list = recurringByLineItem.get(row.lineItemId) ?? [];
    list.push(row.name);
    recurringByLineItem.set(row.lineItemId, list);
  }
  const performancesByLineItem = new Map<string, LineItemPerformanceRow[]>();
  for (const row of performances) {
    const list = performancesByLineItem.get(row.lineItemId) ?? [];
    list.push({
      id: row.id,
      amountCents: row.amountCents,
      name: row.name,
      date: row.date,
      amountLocked: !row.countsTowardContractTotal,
    });
    performancesByLineItem.set(row.lineItemId, list);
  }

  return items.map((item) => {
    const itemPerformances = performancesByLineItem.get(item.id) ?? [];
    return {
      id: item.id,
      name: item.name,
      scheduledValueCents: item.scheduledValueCents,
      totalScheduledValueCents:
        item.scheduledValueCents + itemPerformances.reduce((sum, p) => sum + p.amountCents, 0),
      performances: itemPerformances,
      openingBilledCents: item.openingBilledCents,
      sortOrder: item.sortOrder,
      expenseCount: countByLineItem.get(item.id) ?? 0,
      recurringNames: recurringByLineItem.get(item.id) ?? [],
    };
  });
}

/** Single line item, org-scoped — used by actions before they mutate. */
export async function findLineItem(orgId: string, id: string) {
  const rows = await db
    .select()
    .from(lineItems)
    .where(and(eq(lineItems.id, id), eq(lineItems.orgId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}
