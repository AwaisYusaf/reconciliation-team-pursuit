import "server-only";

/**
 * Shared org-scoped reads.
 *
 * Every function takes an `orgId` that callers must source from the session — never from
 * client input — which is what keeps one organisation's data out of another's screens.
 */
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/src/db";
import { contractSettings, expenses, lineItemPerformances, lineItems } from "@/src/db/schema";
import type { ExpenseAmount, LineItemBudget } from "@/src/domain/budget-math";
import type { MonthKey } from "@/src/domain/dates";
import type { ContractSettingsInput } from "@/src/domain/summary";

/**
 * The connection, or an open transaction.
 *
 * Every loader takes one so a caller that needs several reads to see a single instant can
 * pass its own transaction. Defaulting to `db` keeps the ordinary call sites unchanged —
 * and makes the omission visible: a caller inside a transaction that forgets to pass `tx`
 * is reading outside it, which is exactly what `captureMonthSnapshot` was doing while its
 * comment claimed repeatable-read isolation (D-72).
 */
export type Reader = Pick<typeof db, "select">;

/**
 * Line items in the organisation's configured document order.
 *
 * `scheduledValueCents` is the base value plus every performance added on top (m08) — the one
 * place that total is computed, so the dashboard, Contract Summary, the packet and the Excel
 * workbook all inherit a new performance automatically without their own changes. It still
 * carries `performanceCents` — just the performance slice — alongside it, so a renderer that
 * needs to show the split (Contract Summary, the packet, Excel) doesn't have to re-derive it.
 *
 * `newPerformanceCents` (D-82) is the narrower slice of `performanceCents` that actually counts
 * toward the org's contract total: performances added since `counts_toward_contract_total`
 * started existing, never the migrated Performance Grant or anything else that predates it,
 * since that money was already folded into `contract_value_cents` long before it had a line
 * item of its own.
 */
export async function loadLineItemBudgets(
  orgId: string,
  reader: Reader = db,
): Promise<LineItemBudget[]> {
  const rows = await reader
    .select({
      id: lineItems.id,
      name: lineItems.name,
      // A raw `sql` expression skips Drizzle's own bigint-to-number column mapping, and
      // Postgres returns `numeric` (from `sum`) as a string — coerced back to a number below,
      // the same way `claimReferenceSeq`/`saveLineItemAction` coerce their own raw aggregates.
      scheduledValueCents: sql<string>`${lineItems.scheduledValueCents} + coalesce(sum(${lineItemPerformances.amountCents}), 0)`,
      performanceCents: sql<string>`coalesce(sum(${lineItemPerformances.amountCents}), 0)`,
      newPerformanceCents: sql<string>`coalesce(sum(${lineItemPerformances.amountCents}) filter (where ${lineItemPerformances.countsTowardContractTotal}), 0)`,
      openingBilledCents: lineItems.openingBilledCents,
      sortOrder: lineItems.sortOrder,
    })
    .from(lineItems)
    .leftJoin(lineItemPerformances, eq(lineItemPerformances.lineItemId, lineItems.id))
    .where(eq(lineItems.orgId, orgId))
    .groupBy(lineItems.id)
    // `id` breaks ties deterministically — `loadMonthSnapshot` relies on total ordering for
    // its cache hash (canonicalJson treats array order as data).
    .orderBy(asc(lineItems.sortOrder), asc(lineItems.name), asc(lineItems.id));

  return rows.map((row) => ({
    ...row,
    scheduledValueCents: Number(row.scheduledValueCents),
    performanceCents: Number(row.performanceCents),
    newPerformanceCents: Number(row.newPerformanceCents),
  }));
}

/**
 * Amounts for budget maths, up to and including the reporting month.
 *
 * Later months are excluded at the database rather than in the service: they are not
 * billed yet (R3), and skipping them keeps the payload small for organisations that
 * enter future-dated recurring items.
 */
export async function loadExpenseAmounts(
  orgId: string,
  uptoMonth: MonthKey,
  reader: Reader = db,
): Promise<ExpenseAmount[]> {
  return reader
    .select({
      lineItemId: expenses.lineItemId,
      month: expenses.month,
      subtotalCents: expenses.subtotalCents,
      taxCents: expenses.taxCents,
      feesCents: expenses.feesCents,
      taxReimbursable: expenses.taxReimbursable,
      feesReimbursable: expenses.feesReimbursable,
    })
    .from(expenses)
    .where(
      and(eq(expenses.orgId, orgId), lte(expenses.month, uptoMonth), isNull(expenses.deletedAt)),
    );
}

/** Contract settings, with zeroed defaults when onboarding skipped them. */
export async function loadContractSettings(
  orgId: string,
  reader: Reader = db,
): Promise<ContractSettingsInput> {
  const rows = await reader
    .select({
      contractValueCents: contractSettings.contractValueCents,
      advancesReceivedCents: contractSettings.advancesReceivedCents,
    })
    .from(contractSettings)
    .where(eq(contractSettings.orgId, orgId))
    .limit(1);

  return rows[0] ?? { contractValueCents: 0, advancesReceivedCents: 0 };
}
