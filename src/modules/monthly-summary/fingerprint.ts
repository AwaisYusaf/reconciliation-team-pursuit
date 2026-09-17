/**
 * The stored `expenses_fingerprint` (Phase 11, D-107, P7).
 *
 * A sha256 (not `inputsHash`, which truncates to 32 hex characters) of the canonical JSON of the
 * month's live expenses, limited to exactly the fields the summary reads. Recomputed on load and
 * compared against the stored value to show "records changed since this was written" — writing
 * never touches it, only Write again does, because only Write again re-reads the records.
 *
 * Pure: no IO, so the loader and any future backfill can call it identically.
 */
import { createHash } from "node:crypto";

import { canonicalJson } from "@/src/generation/cache-key";
import type { SummaryExpense } from "@/src/domain/monthly-summary-facts";

export function expensesFingerprint(expenses: readonly SummaryExpense[]): string {
  const rows = expenses
    .map((expense) => ({
      id: expense.id,
      lineItemId: expense.lineItemId,
      name: expense.name,
      description: expense.description,
      narrative: expense.narrative,
      note: expense.note,
      date: expense.date,
      subtotalCents: expense.subtotalCents,
      taxCents: expense.taxCents,
      feesCents: expense.feesCents,
      taxReimbursable: expense.taxReimbursable,
      feesReimbursable: expense.feesReimbursable,
      noReceipt: expense.noReceipt,
      noReceiptReason: expense.noReceiptReason,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return createHash("sha256").update(canonicalJson(rows)).digest("hex");
}
