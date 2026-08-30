/**
 * Packet ordering (packet-pdf-spec §Canonical section order).
 *
 * The order is what makes a 130-page submission reviewable, and R11.2 points the UI at these
 * same functions — so the screen's listing and the assembled file cannot disagree.
 */
import { describe, expect, it } from "vitest";

import type { SnapshotDocument, SnapshotExpense, SnapshotMonthDocument } from "./month-snapshot";
import { orderedMonthDocuments, packetDocumentsFor } from "./packet-order";

function monthDocument(
  overrides: Partial<SnapshotMonthDocument> & { id: string },
): SnapshotMonthDocument {
  return {
    category: "other",
    title: null,
    s3Key: `org/o/months/2026-02/month-docs/${overrides.id}.pdf`,
    filename: `${overrides.id}.pdf`,
    mimeType: "application/pdf",
    pageCount: 1,
    widthPx: null,
    heightPx: null,
    sizeBytes: 1000,
    sortOrder: 0,
    ...overrides,
  };
}

function document(overrides: Partial<SnapshotDocument> & { id: string }): SnapshotDocument {
  return {
    kind: "receipt",
    supportingType: null,
    s3Key: `org/o/months/2026-02/expenses/e/receipt/${overrides.id}.jpg`,
    filename: `${overrides.id}.jpg`,
    mimeType: "image/jpeg",
    pageCount: 1,
    widthPx: 800,
    heightPx: 1000,
    sizeBytes: 1000,
    sortOrder: 0,
    ...overrides,
  };
}

function expense(documents: SnapshotDocument[]): SnapshotExpense {
  return {
    id: "e1",
    lineItemId: "li",
    lineItemName: "Analytical Support",
    name: "Vendor",
    description: "Something",
    date: "2026-02-10",
    paymentSource: "Paid by us, reimbursement requested",
    subtotalCents: 1000,
    taxCents: 0,
    feesCents: 0,
    note: null,
    narrative: null,
    noReceipt: false,
    noReceiptReason: null,
    sortOrder: 0,
    referenceSeq: 1,
    documents,
  };
}

describe("month documents (section 2)", () => {
  it("orders by category, then sort order", () => {
    const ordered = orderedMonthDocuments([
      monthDocument({ id: "other", category: "other" }),
      monthDocument({ id: "invoice", category: "fiduciary_invoice" }),
      monthDocument({ id: "timesheet", category: "timesheet" }),
      monthDocument({ id: "hours", category: "combined_hours" }),
      monthDocument({ id: "bank", category: "bank_statement" }),
    ]);

    expect(ordered.map((row) => row.id)).toEqual([
      "bank",
      "hours",
      "timesheet",
      "invoice",
      "other",
    ]);
  });

  it("keeps sort order within a category", () => {
    const ordered = orderedMonthDocuments([
      monthDocument({ id: "b", category: "timesheet", sortOrder: 2 }),
      monthDocument({ id: "a", category: "timesheet", sortOrder: 1 }),
      monthDocument({ id: "c", category: "timesheet", sortOrder: 3 }),
    ]);
    expect(ordered.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  /**
   * Sort order is assigned by a count that can race, so ties are reachable. Without a
   * tiebreak the packet's order would vary between builds and the cache key with it.
   */
  it("breaks sort-order ties deterministically", () => {
    const input = [
      monthDocument({ id: "zzz", category: "timesheet", sortOrder: 1 }),
      monthDocument({ id: "aaa", category: "timesheet", sortOrder: 1 }),
    ];
    expect(orderedMonthDocuments(input).map((row) => row.id)).toEqual(["aaa", "zzz"]);
    // Reversing the input must not change the result.
    expect(orderedMonthDocuments([...input].reverse()).map((row) => row.id)).toEqual([
      "aaa",
      "zzz",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [
      monthDocument({ id: "other", category: "other" }),
      monthDocument({ id: "bank", category: "bank_statement" }),
    ];
    orderedMonthDocuments(input);
    expect(input.map((row) => row.id)).toEqual(["other", "bank"]);
  });

  it("handles a month with no documents", () => {
    expect(orderedMonthDocuments([])).toEqual([]);
  });
});

describe("expense documents (sections 3..n)", () => {
  it("puts receipts before supporting documents, each in upload order", () => {
    const ordered = packetDocumentsFor(
      expense([
        document({ id: "support-2", kind: "supporting", supportingType: "Check copy", sortOrder: 2 }),
        document({ id: "receipt-2", kind: "receipt", sortOrder: 2 }),
        document({ id: "support-1", kind: "supporting", supportingType: "Check copy", sortOrder: 1 }),
        document({ id: "receipt-1", kind: "receipt", sortOrder: 1 }),
      ]),
    );

    expect(ordered.map((row) => row.id)).toEqual([
      "receipt-1",
      "receipt-2",
      "support-1",
      "support-2",
    ]);
  });

  /**
   * Proofs live inside the cover sheet and nowhere else (R11.3). The manual packet repeated
   * them as thirty standalone pages at the back; duplicating them here would undo the single
   * biggest improvement over the hand-assembled version.
   */
  it("never emits a proof as a standalone page (R11.3)", () => {
    const ordered = packetDocumentsFor(
      expense([
        document({ id: "proof-1", kind: "proof" }),
        document({ id: "receipt-1", kind: "receipt" }),
        document({ id: "proof-2", kind: "proof", sortOrder: 1 }),
      ]),
    );

    expect(ordered.map((row) => row.id)).toEqual(["receipt-1"]);
    expect(ordered.some((row) => row.kind === "proof")).toBe(false);
  });

  it("ignores the supporting type when ordering", () => {
    const ordered = packetDocumentsFor(
      expense([
        document({ id: "b", kind: "supporting", supportingType: "Zebra doc", sortOrder: 1 }),
        document({ id: "a", kind: "supporting", supportingType: "Alpha doc", sortOrder: 0 }),
      ]),
    );
    // Upload order, not label order.
    expect(ordered.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("breaks ties deterministically here too", () => {
    const input = expense([
      document({ id: "zzz", kind: "receipt", sortOrder: 0 }),
      document({ id: "aaa", kind: "receipt", sortOrder: 0 }),
    ]);
    expect(packetDocumentsFor(input).map((row) => row.id)).toEqual(["aaa", "zzz"]);
  });

  it("returns nothing for an expense marked no-receipt with no uploads", () => {
    expect(packetDocumentsFor(expense([]))).toEqual([]);
  });
});
