/**
 * Packet ordering rules (packet-pdf-spec §Canonical section order).
 *
 * Pure and free of any storage or database import, because R11.2 points the Month-End Packet
 * screen at these same functions: the contents listing the user reads and the file that is
 * actually assembled must be produced by one implementation, not two that agree today.
 */
import type { SnapshotDocument, SnapshotExpense, SnapshotMonthDocument } from "./month-snapshot";

/** The authority the UI groups mirror (R11.2). */
const CATEGORY_ORDER = [
  "bank_statement",
  "combined_hours",
  "timesheet",
  "fiduciary_invoice",
  "other",
];

/**
 * Sort order is assigned from a count that can race, and a value is reused after a delete,
 * so ties are reachable. Falling back to the id keeps the packet's order — and therefore its
 * cache key — identical between builds.
 */
function byOrderThenId(
  a: { sortOrder: number; id: string },
  b: { sortOrder: number; id: string },
): number {
  return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
}

/** Month documents in category order, then by sort order (section 2). */
export function orderedMonthDocuments(
  documents: readonly SnapshotMonthDocument[],
): SnapshotMonthDocument[] {
  return [...documents].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      byOrderThenId(a, b),
  );
}

/**
 * An expense's packet documents: receipts first, then supporting, each in upload order.
 *
 * Proofs are deliberately absent — they appear only inside the cover sheet (R11.3). The
 * manual packet repeated them as thirty standalone pages at the back; removing that
 * duplication is the single biggest improvement over the hand-assembled version.
 */
export function packetDocumentsFor(expense: SnapshotExpense): SnapshotDocument[] {
  return [
    ...expense.documents.filter((document) => document.kind === "receipt").sort(byOrderThenId),
    ...expense.documents.filter((document) => document.kind === "supporting").sort(byOrderThenId),
  ];
}
