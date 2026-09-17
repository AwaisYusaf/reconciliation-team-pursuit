import "server-only";

/**
 * The month facts loader (Phase 11, D-107, P2).
 *
 * One repeatable-read, read-only transaction — same shape as `loadMonthSnapshot`
 * (`src/generation/month-snapshot.ts:312`) — so the facts and the fingerprint describe the same
 * instant. Reuses the Dashboard/Contract Summary loaders (`loadLineItemBudgets`,
 * `loadExpenseAmounts`, `loadFundingSourceSettings`) rather than querying budget figures again.
 */
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/src/db";
import { loadExpenseAmounts, loadFundingSourceSettings, loadLineItemBudgets } from "@/src/db/queries";
import { expenses, fundingSources, organizations } from "@/src/db/schema";
import { isValidMonthKey, type MonthKey } from "@/src/domain/dates";
import { buildMonthFacts, type MonthFacts, type SummaryExpense } from "@/src/domain/monthly-summary-facts";
import { isUuid } from "@/src/lib/ids";

import { expensesFingerprint } from "./fingerprint";

/**
 * The facts for one funding source's month, and the fingerprint of the expenses they were built
 * from. Returns `null` for an invalid month key, a non-uuid source id, or a source not owned by
 * this organisation — every case the caller should treat as "not found", not throw.
 */
export async function loadMonthFacts(
  orgId: string,
  sourceId: string,
  month: MonthKey,
): Promise<{ facts: MonthFacts; fingerprint: string } | null> {
  if (!isValidMonthKey(month)) return null;
  if (!isUuid(sourceId)) return null;

  return db.transaction(
    async (tx) => {
      const [source] = await tx
        .select({ name: fundingSources.name, docName: fundingSources.docName })
        .from(fundingSources)
        .where(and(eq(fundingSources.id, sourceId), eq(fundingSources.orgId, orgId)))
        .limit(1);
      if (!source) return null;

      const [org] = await tx
        .select({ docName: organizations.docName })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      if (!org) return null;

      const monthExpenses: SummaryExpense[] = await tx
        .select({
          id: expenses.id,
          lineItemId: expenses.lineItemId,
          name: expenses.name,
          description: expenses.description,
          narrative: expenses.narrative,
          note: expenses.note,
          date: expenses.date,
          subtotalCents: expenses.subtotalCents,
          taxCents: expenses.taxCents,
          feesCents: expenses.feesCents,
          taxReimbursable: expenses.taxReimbursable,
          feesReimbursable: expenses.feesReimbursable,
          noReceipt: expenses.noReceipt,
          noReceiptReason: expenses.noReceiptReason,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.orgId, orgId),
            eq(expenses.fundingSourceId, sourceId),
            eq(expenses.month, month),
            isNull(expenses.deletedAt),
          ),
        )
        .orderBy(asc(expenses.sortOrder), asc(expenses.id));

      // Sequential, like `loadMonthSnapshot`: one transaction's client processes one query at a
      // time anyway, and this keeps every read in this transaction in a fixed, reviewable order.
      const lineItems = await loadLineItemBudgets(orgId, sourceId, tx);
      const expensesUpToMonth = await loadExpenseAmounts(orgId, sourceId, month, tx);
      const settings = await loadFundingSourceSettings(orgId, sourceId, tx);

      const facts = buildMonthFacts({
        orgDocName: org.docName,
        source,
        month,
        lineItems,
        expensesUpToMonth,
        monthExpenses,
        settings,
      });

      return { facts, fingerprint: expensesFingerprint(monthExpenses) };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
