import "server-only";

/**
 * Shared org-scoped reads.
 *
 * Every function takes an `orgId` that callers must source from the session — never from
 * client input — which is what keeps one organisation's data out of another's screens.
 */
import { and, asc, eq, lte } from "drizzle-orm";

import { db } from "@/src/db";
import { contractSettings, expenses, lineItems } from "@/src/db/schema";
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

/** Line items in the organisation's configured document order. */
export async function loadLineItemBudgets(
  orgId: string,
  reader: Reader = db,
): Promise<LineItemBudget[]> {
  return reader
    .select({
      id: lineItems.id,
      name: lineItems.name,
      scheduledValueCents: lineItems.scheduledValueCents,
      openingBilledCents: lineItems.openingBilledCents,
      sortOrder: lineItems.sortOrder,
    })
    .from(lineItems)
    .where(eq(lineItems.orgId, orgId))
    .orderBy(asc(lineItems.sortOrder), asc(lineItems.name));
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
    .where(and(eq(expenses.orgId, orgId), lte(expenses.month, uptoMonth)));
}

/** Contract settings, with zeroed defaults when onboarding skipped them. */
export async function loadContractSettings(
  orgId: string,
  reader: Reader = db,
): Promise<ContractSettingsInput> {
  const rows = await reader
    .select({
      contractValueCents: contractSettings.contractValueCents,
      perfGrantScheduledCents: contractSettings.perfGrantScheduledCents,
      perfGrantBilledCents: contractSettings.perfGrantBilledCents,
      advancesReceivedCents: contractSettings.advancesReceivedCents,
    })
    .from(contractSettings)
    .where(eq(contractSettings.orgId, orgId))
    .limit(1);

  return (
    rows[0] ?? {
      contractValueCents: 0,
      perfGrantScheduledCents: 0,
      perfGrantBilledCents: 0,
      advancesReceivedCents: 0,
    }
  );
}
