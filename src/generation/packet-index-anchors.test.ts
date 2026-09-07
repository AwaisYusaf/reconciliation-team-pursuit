/**
 * The index records where its clickable cells are while it draws them (D-83).
 */
import { describe, expect, it } from "vitest";

import { FEB, FEB_EXPENSES, LINE_ITEMS, SETTINGS } from "@/src/domain/fixtures";
import { expenseReference } from "@/src/domain/strings";

import type { MonthSnapshot } from "./month-snapshot";
import { INDEX_COLUMNS, buildIndexSection } from "./packet-index-pdf";

const snapshot: MonthSnapshot = {
  orgId: "org",
  docName: "Team Pursuit",
  month: FEB,
  lineItems: LINE_ITEMS,
  amounts: FEB_EXPENSES,
  monthDocuments: [],
  expenses: [],
  settings: { ...SETTINGS, projectName: "", contractNumber: "", basePoNumber: "", performancePoNumber: "", fiduciaryName: "" },
};

function expense(seq: number, noReceipt = false): MonthSnapshot["expenses"][number] {
  return {
    id: `e-${seq}`,
    lineItemId: LINE_ITEMS[0].id,
    lineItemName: LINE_ITEMS[0].name,
    name: `Expense ${seq}`,
    description: "Role",
    date: `${FEB}-10`,
    paymentSource: "Paid by us, reimbursement requested",
    subtotalCents: 1_000,
    taxCents: 0,
    feesCents: 0,
    taxReimbursable: false,
    feesReimbursable: true,
    note: null,
    narrative: "n",
    noReceipt,
    noReceiptReason: noReceipt ? "Paid in cash, receipt lost" : null,
    sortOrder: seq,
    referenceSeq: seq,
    documents: [],
  };
}

describe("buildIndexSection anchors", () => {
  it("records one Ref cell per row, in the Ref column, in row order", async () => {
    const { anchors } = await buildIndexSection({ ...snapshot, expenses: [expense(3), expense(1), expense(2)] });
    expect(anchors.refCells.map((cell) => cell.reference)).toEqual(
      [1, 2, 3].map((seq) => expenseReference(FEB, seq)),
    );
    for (const cell of anchors.refCells) {
      expect(cell.page).toBe(0);
      expect(cell.rect.width).toBe(INDEX_COLUMNS[0].width);
      expect(cell.rect.height).toBeGreaterThan(0);
    }
    // Rows stack downward: each cell sits below the previous one, never overlapping.
    for (let i = 1; i < anchors.refCells.length; i += 1) {
      const above = anchors.refCells[i - 1].rect;
      const below = anchors.refCells[i].rect;
      expect(below.y + below.height).toBeLessThanOrEqual(above.y + 0.01);
    }
  });

  it("records a disclosure line only for no-receipt expenses, with a top above its rect", async () => {
    const { anchors } = await buildIndexSection({ ...snapshot, expenses: [expense(1), expense(2, true)] });
    expect(anchors.disclosures.map((line) => line.reference)).toEqual([expenseReference(FEB, 2)]);
    const [line] = anchors.disclosures;
    expect(line.top).toBeGreaterThanOrEqual(line.rect.y + line.rect.height);
    // The disclosure block sits below the table on the same page.
    expect(line.page).toBe(0);
    expect(line.rect.y).toBeLessThan(anchors.refCells.at(-1)!.rect.y);
  });

  it("follows rows onto a second page when the table overflows", async () => {
    const many = Array.from({ length: 60 }, (_, i) => expense(i + 1));
    const { anchors, pdf } = await buildIndexSection({ ...snapshot, expenses: many });
    expect(anchors.refCells).toHaveLength(60);
    expect(new Set(anchors.refCells.map((cell) => cell.page))).toEqual(new Set([0, 1]));
    expect(pdf.byteLength).toBeGreaterThan(0);
  });
});
