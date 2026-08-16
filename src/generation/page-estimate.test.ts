/**
 * The estimate the packet screen shows, checked against the document that is actually
 * produced.
 *
 * m06's acceptance is "page counts within ±2 of the generated PDF". A formula that drifts
 * from the renderer would tell the user to expect 40 pages and hand them 60, so the
 * calibration cases below build the real docx, convert it with the real LibreOffice, and
 * compare. They skip when LibreOffice or poppler is absent.
 */
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { coverSheetRows, type CoverSheetExpense } from "@/src/domain/cover-sheet";

import { buildCoverSheetDocx, type CoverImage } from "./cover-sheet-docx";
import { conversionAvailable, convertDocxToPdf } from "./docx-to-pdf";
import { estimateCoverSheetPages, estimateUploadPages, type EstimateRow } from "./page-estimate";
import { pdfPageCount } from "./raster";

const available = await conversionAvailable();

function hasPoppler(): boolean {
  try {
    execFileSync("pdfinfo", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function expense(overrides: Partial<CoverSheetExpense> = {}): CoverSheetExpense {
  return {
    name: "Vendor",
    description: "Contracted services in support of programme delivery",
    subtotalCents: 100_000,
    taxCents: 0,
    feesCents: 0,
    note: null,
    narrative: null,
    noReceipt: false,
    noReceiptReason: null,
    ...overrides,
  };
}

/** A rasterised Letter page at 150 DPI, the shape a PDF proof actually produces. */
const RASTERISED_PAGE = { widthPx: 1275, heightPx: 1650 };

function rowsFrom(
  expenses: CoverSheetExpense[],
  proofsPer: number,
): { estimate: EstimateRow[]; images: CoverImage[][] } {
  const composed = coverSheetRows(expenses);
  return {
    estimate: composed.rows.map((row) => ({
      role: row.role,
      notes: row.notes,
      narrative: row.narrative,
      proofs: Array.from({ length: proofsPer }, () => RASTERISED_PAGE),
    })),
    images: composed.rows.map(() =>
      Array.from({ length: proofsPer }, () => ({
        // A real JPEG is not needed for a page count, only its dimensions.
        data: Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
        ...RASTERISED_PAGE,
      })),
    ),
  };
}

describe("estimateCoverSheetPages", () => {
  it("is one page for a sheet with no expenses", () => {
    expect(estimateCoverSheetPages([])).toBe(1);
  });

  it("is one page when a few rows carry no proofs", () => {
    const { estimate } = rowsFrom([expense(), expense(), expense()], 0);
    expect(estimateCoverSheetPages(estimate)).toBe(1);
  });

  it("gives a full-page proof its own page", () => {
    // One table page, then one page per proof.
    const { estimate } = rowsFrom([expense(), expense(), expense(), expense()], 1);
    expect(estimateCoverSheetPages(estimate)).toBe(5);
  });

  it("grows with the number of proofs", () => {
    const one = estimateCoverSheetPages(rowsFrom([expense(), expense()], 1).estimate);
    const three = estimateCoverSheetPages(rowsFrom([expense(), expense()], 3).estimate);
    expect(three).toBeGreaterThan(one);
  });

  it("spills the table onto a second page when there are many rows", () => {
    const many = Array.from({ length: 40 }, () => expense());
    expect(estimateCoverSheetPages(rowsFrom(many, 0).estimate)).toBeGreaterThan(1);
  });

  it("lets small proofs share a page instead of each taking one", () => {
    const composed = coverSheetRows([expense()]);
    const small: EstimateRow[] = composed.rows.map((row) => ({
      role: row.role,
      notes: row.notes,
      narrative: row.narrative,
      proofs: Array.from({ length: 4 }, () => ({ widthPx: 400, heightPx: 150 })),
    }));
    const full: EstimateRow[] = composed.rows.map((row) => ({
      role: row.role,
      notes: row.notes,
      narrative: row.narrative,
      proofs: Array.from({ length: 4 }, () => RASTERISED_PAGE),
    }));

    // Four full-page scans need a page each; four small crops must not.
    expect(estimateCoverSheetPages(full)).toBe(5);
    expect(estimateCoverSheetPages(small)).toBeLessThan(3);
  });
});

describe("estimateUploadPages", () => {
  it("sums the stored page counts", () => {
    expect(estimateUploadPages([{ pageCount: 3 }, { pageCount: 1 }, { pageCount: 12 }])).toBe(16);
  });

  it("counts an unprocessed upload as one page rather than none", () => {
    expect(estimateUploadPages([{ pageCount: null }, { pageCount: 2 }])).toBe(3);
  });

  it("is zero for a month with no uploads", () => {
    expect(estimateUploadPages([])).toBe(0);
  });
});

/**
 * The estimate is only worth showing if it tracks the renderer. Each case builds the real
 * document and compares — the tolerance is the spec's ±2.
 */
describe.skipIf(!available || !hasPoppler())("calibration against the real renderer", () => {
  const cases: Array<{ name: string; expenses: CoverSheetExpense[]; proofs: number }> = [
    { name: "two rows, one proof each", expenses: [expense(), expense()], proofs: 1 },
    {
      name: "four rows, one proof each (February's Social Services shape)",
      expenses: [expense(), expense(), expense(), expense()],
      proofs: 1,
    },
    { name: "nine rows, one proof each", expenses: Array.from({ length: 9 }, () => expense()), proofs: 1 },
    { name: "three rows, two proofs each", expenses: Array.from({ length: 3 }, () => expense()), proofs: 2 },
    { name: "twenty-two rows, no proofs", expenses: Array.from({ length: 22 }, () => expense()), proofs: 0 },
    {
      name: "rows with notes and narratives",
      expenses: [
        expense({ taxCents: 500, note: "Aggregated from four separate receipts" }),
        expense({ narrative: "Staff paid personally and were reimbursed in a single transfer." }),
        expense({ noReceipt: true, noReceiptReason: "vendor could not reissue" }),
      ],
      proofs: 1,
    },
  ];

  for (const testCase of cases) {
    it(`is within ±2 pages: ${testCase.name}`, async () => {
      const { estimate, images } = rowsFrom(testCase.expenses, testCase.proofs);
      const composed = coverSheetRows(testCase.expenses);

      const docx = await buildCoverSheetDocx({
        title: "Team Pursuit February 2026 Analytical Support Breakdown",
        rows: composed.rows,
        totalCents: composed.totalCents,
        images,
      });
      const actual = await pdfPageCount(await convertDocxToPdf(docx));
      const predicted = estimateCoverSheetPages(estimate);

      expect(Math.abs(predicted - actual)).toBeLessThanOrEqual(2);
    }, 200_000);
  }
});
