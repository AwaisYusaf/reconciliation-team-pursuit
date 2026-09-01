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

/** Month documents in category order, then by sort order (the final section). */
export function orderedMonthDocuments(
  documents: readonly SnapshotMonthDocument[],
): SnapshotMonthDocument[] {
  // An unrecognised category sorts last, not first: `indexOf` returns -1, which would put a
  // future enum value ahead of the bank statement at the head of the month-documents section.
  const rank = (category: string) => {
    const index = CATEGORY_ORDER.indexOf(category);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };

  return [...documents].sort(
    (a, b) => rank(a.category) - rank(b.category) || byOrderThenId(a, b),
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


/** One row of the packet's contents, in the order a reader meets it. */
export type PacketSection = {
  /** Stable key for React, and for saying which section a row is. */
  key: string;
  label: string;
  pages: number;
};

/**
 * The packet's section sequence — the single place it is declared (R11.2).
 *
 * The Month-End Packet screen tells the user this is "the order the funder will read them", so
 * the listing and the assembled file have to be the same order. They used to be two hand-written
 * sequences: `buildPacketPdf`'s statement order, and a hardcoded `<ol>` of `index={1}`,
 * `index={2}`, `index={3}`, `index + 4`. Nothing connected them, and this project's every shipped
 * defect has been two paths that had to agree where only one was updated.
 *
 * Month documents come last (D-77). They are month-level backup — bank statements, timesheets —
 * and putting them first meant a bank statement was the first thing after the summary, ahead of
 * the first cover letter. `buildPacketPdf` appends in this same order; the integration test
 * asserts the rendered packet ends with them, so the two cannot drift silently.
 */
export function packetContents(input: {
  summaryPages: number;
  indexPages: number;
  monthDocumentPages: number;
  lineItems: readonly { lineItemId: string; name: string; estimatedPages: number }[];
}): PacketSection[] {
  return [
    { key: "summary", label: "Contract summary sheet", pages: input.summaryPages },
    { key: "index", label: "Expense index", pages: input.indexPages },
    ...input.lineItems.map((lineItem) => ({
      key: lineItem.lineItemId,
      label: `${lineItem.name} — cover sheet + documents`,
      pages: lineItem.estimatedPages,
    })),
    { key: "monthDocuments", label: "Month documents", pages: input.monthDocumentPages },
  ];
}
