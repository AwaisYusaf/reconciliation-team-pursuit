/**
 * The stored `expenses_fingerprint` (Phase 11, D-107, P7): a sha256 of the facts the summary was
 * written from. Recomputed on load and compared against the stored value to show "records changed
 * since this was written" — saving an edit never touches it, only Write again does, because only
 * Write again re-reads the records.
 *
 * It hashes the whole facts object the model was given, not just this month's expenses (PR #18
 * round 2, #7): a budget edit, an earlier month's expense, or a contract total all change figures
 * in the summary — Budget position, Changes from last month — without touching a single expense
 * in this month, and the notice stayed silent for them. The column keeps its original name.
 *
 * Order-free where order means nothing: each line item's expense list follows the user's own list
 * order, and dragging a row must not mark the summary as changed.
 *
 * Pure: no IO, so the loader and any future backfill can call it identically.
 */
import { createHash } from "node:crypto";

import { canonicalJson } from "@/src/generation/cache-key";
import type { MonthFacts } from "@/src/domain/monthly-summary-facts";

export function factsFingerprint(facts: MonthFacts): string {
  const orderFree = {
    ...facts,
    spending: facts.spending.map((group) => ({
      ...group,
      expenses: group.expenses.map((expense) => canonicalJson(expense)).sort(),
    })),
  };
  return createHash("sha256").update(canonicalJson(orderFree)).digest("hex");
}
