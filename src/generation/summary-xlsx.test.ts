/**
 * The workbook is read by City reviewers, so these assertions check what actually lands in
 * the cells — values, number formats and fills — not just that a file was produced.
 *
 * The fixture is deliberately self-consistent: `amounts` is derived from `expenses`, the way
 * `loadMonthSnapshot` derives it, so the Contract Summary sheet and the Detail sheet are
 * built from the same records. A fixture whose two sheets describe different data cannot
 * detect the failure that matters most here — the sheets disagreeing (R10.2).
 */
import ExcelJS, { type Worksheet } from "exceljs";
import { describe, expect, it } from "vitest";

import { FEB, FEB_EXPENSES, LINE_ITEMS, SETTINGS } from "@/src/domain/fixtures";

import type { MonthSnapshot, SnapshotExpense } from "./month-snapshot";
import { buildSummaryWorkbook, summaryWorkbookName } from "./summary-xlsx";

/** One expense per line item, each carrying that line item's published February figure. */
const EXPENSES: SnapshotExpense[] = FEB_EXPENSES.map((amount, index) => {
  const lineItem = LINE_ITEMS.find((item) => item.id === amount.lineItemId)!;
  return {
    id: `e${index}`,
    lineItemId: amount.lineItemId,
    lineItemName: lineItem.name,
    // A name beginning with `=` probes the formula-injection guard.
    name: index === 0 ? "=cmd|calc" : `${lineItem.name} vendor`,
    description: `February spend on ${lineItem.name}`,
    date: `2026-02-${String(index + 2).padStart(2, "0")}`,
    paymentSource: "Paid by us, reimbursement requested",
    subtotalCents: amount.subtotalCents,
    // Tax is excluded from the reimbursable amount, so it must not disturb the
    // reconciliation between the two sheets (R1.3).
    taxCents: index === 1 ? 12_34 : 0,
    feesCents: amount.feesCents,
    taxReimbursable: false,
    feesReimbursable: true,
    note: null,
    narrative: null,
    noReceipt: false,
    noReceiptReason: null,
    sortOrder: index,
    referenceSeq: index + 1,
    documents: [],
  };
});

const snapshot: MonthSnapshot = {
  orgId: "org",
  docName: "Team Pursuit",
  month: FEB,
  lineItems: LINE_ITEMS,
  amounts: FEB_EXPENSES,
  monthDocuments: [],
  expenses: EXPENSES,
  settings: {
    ...SETTINGS,
    projectName: "Community Violence Intervention",
    contractNumber: "6007211",
    basePoNumber: "3086984",
    performancePoNumber: "3089749",
    fiduciaryName: "Detroit Crime Commission",
  },
};

async function open() {
  const buffer = await buildSummaryWorkbook(snapshot);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

describe("Contract Summary sheet", () => {
  it("has both sheets, named as the spec requires", async () => {
    const workbook = await open();
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Contract Summary",
      "Feb Detail",
    ]);
  });

  it("writes the header row bold on yellow", async () => {
    const sheet = (await open()).getWorksheet("Contract Summary")!;
    const header = sheet.getRow(1);
    expect(header.getCell(1).value).toBe("Description of Work");
    expect(header.getCell(7).value).toBe("Balance to Finish");
    expect(header.getCell(1).font?.bold).toBe(true);
    expect((header.getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFFFF00");
  });

  it("borders the section divider row, which sits inside the table", async () => {
    const sheet = (await open()).getWorksheet("Contract Summary")!;
    // Only "BASE" remains — the "PERFORMANCE GRANT 1" divider is gone with R7.2 (m08).
    for (const rowNumber of [2]) {
      const row = sheet.getRow(rowNumber);
      expect(row.getCell(1).border?.top?.style).toBe("thin");
      // The border must run the full merged span, not just the first cell.
      expect(row.getCell(7).border?.bottom?.style).toBe("thin");
    }
  });

  it("reproduces the published BASE rows as numbers, not strings", async () => {
    const sheet = (await open()).getWorksheet("Contract Summary")!;
    // Row 1 header, row 2 BASE divider, rows 3.. line items.
    const salary = sheet.getRow(3);
    expect(salary.getCell(1).value).toBe("Salary");
    expect(salary.getCell(2).value).toBe(458692.46);
    expect(salary.getCell(3).value).toBe(350000);
    expect(salary.getCell(4).value).toBe(45641.12);
    expect(salary.getCell(5).value).toBe(395641.12);
    expect(salary.getCell(7).value).toBe(63051.34);
    // Locale-pinned on purpose: a bare `"$"` is localised by Numbers and LibreOffice, which
    // rendered this workbook with Hong Kong dollars on a reader in another region.
    expect(salary.getCell(2).numFmt).toBe("[$$-409]#,##0.00");
  });

  it("writes percentages already rounded, so Excel cannot round them differently", async () => {
    const sheet = (await open()).getWorksheet("Contract Summary")!;
    // 395641.12 / 458692.46 = 86.25% -> 86% (R1.5, half away from zero).
    expect(sheet.getRow(3).getCell(6).value).toBe(0.86);
    expect(sheet.getRow(3).getCell(6).numFmt).toBe("0%");
    // Every percentage is a whole number of percent, never a longer fraction. Rows 3-9 are the
    // seven BASE line items (Performance Grant 1 among them — R7.2 retired, m08), row 10 the
    // totals — the only bottom-line row now that there's no second section to subtotal against.
    for (const rowNumber of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const value = sheet.getRow(rowNumber).getCell(6).value as number;
      expect(Math.round(value * 100)).toBeCloseTo(value * 100, 9);
    }
  });

  it("carries Performance Grant 1 as an ordinary base row, then one totals row", async () => {
    const sheet = (await open()).getWorksheet("Contract Summary")!;
    // No longer a separate section (R7.2 retired) — it is base row 9, the 7th line item.
    const perf = sheet.getRow(9);
    expect(perf.getCell(1).value).toBe("Performance Grant 1");
    expect(perf.getCell(2).value).toBe(175000);
    expect(perf.getCell(4).value).toBe(0);

    // No "Base subtotal" row: it would only ever repeat this Totals row now that every line
    // item is a base row.
    const totals = sheet.getRow(10);
    expect(totals.getCell(1).value).toBe("Totals");
    expect(totals.getCell(2).value).toBe(854916.67);
    expect(totals.getCell(5).value).toBe(616627.93);
    expect(totals.getCell(7).value).toBe(238288.74);
    expect(totals.getCell(1).font?.bold).toBe(true);
  });

  it("writes the reconciliation block after a blank row", async () => {
    const sheet = (await open()).getWorksheet("Contract Summary")!;
    expect(sheet.getRow(12).getCell(1).value).toBe("Total advances received");
    expect(sheet.getRow(12).getCell(2).value).toBe(665000);
    expect(sheet.getRow(13).getCell(2).value).toBe(616627.93);
    expect(sheet.getRow(14).getCell(2).value).toBe(48372.07);
    expect(sheet.getRow(15).getCell(1).value).toBe(
      "Percentage of advance payments reconciled",
    );
    // 616627.93 / 665000 = 92.73% -> 93%.
    expect(sheet.getRow(15).getCell(2).value).toBe(0.93);
    expect(sheet.getRow(15).getCell(2).numFmt).toBe("0%");
  });

  it("uses the documented column widths", async () => {
    const sheet = (await open()).getWorksheet("Contract Summary")!;
    expect(sheet.columns?.slice(0, 7).map((column) => column.width)).toEqual([
      34, 16, 16, 14, 18, 12, 16,
    ]);
  });
});

describe("Detail sheet", () => {
  it("lists every expense grouped by line item, in line item order", async () => {
    const sheet = (await open()).getWorksheet("Feb Detail")!;
    expect(sheet.getRow(2).getCell(3).value).toBe("Salary");
    expect(sheet.getRow(3).getCell(3).value).toBe("Analytical Support");
    // Header + six expenses + totals.
    expect(sheet.rowCount).toBe(8);
  });

  /**
   * Columns are located by their header rather than by index, so inserting one shifts nothing
   * silently — which is exactly what happened when "Receipt Total" was added between Fees and
   * Reimbursable Amount and the index-based assertions started reading the wrong column.
   */
  function columnOf(sheet: Worksheet, header: string): number {
    const row = sheet.getRow(1);
    for (let index = 1; index <= row.cellCount; index += 1) {
      if (row.getCell(index).value === header) return index;
    }
    throw new Error(`No "${header}" column on ${sheet.name}`);
  }

  it("carries the payment source column and excludes tax from reimbursable", async () => {
    const sheet = (await open()).getWorksheet("Feb Detail")!;
    expect(sheet.getRow(1).getCell(5).value).toBe("Payment Source");
    expect(sheet.getRow(2).getCell(5).value).toBe("Paid by us, reimbursement requested");

    // Analytical Support carries $12.34 of tax, which must not reach the reimbursable column
    // under the original rule — but must appear in the receipt total beside it (R1.3).
    const analytical = sheet.getRow(3);
    expect(analytical.getCell(columnOf(sheet, "Subtotal")).value).toBe(19890.83);
    expect(analytical.getCell(columnOf(sheet, "Tax")).value).toBe(12.34);
    expect(analytical.getCell(columnOf(sheet, "Reimbursable Amount")).value).toBe(19890.83);
    expect(analytical.getCell(columnOf(sheet, "Receipt Total")).value).toBe(19903.17);
  });

  /**
   * The whole point of the workbook: the detail must add up to the summary. This is the
   * assertion that fails if the two sheets are ever built from different sets of records.
   */
  it("reconciles exactly with the Contract Summary sheet (R10.2)", async () => {
    const workbook = await open();
    const summary = workbook.getWorksheet("Contract Summary")!;
    const detail = workbook.getWorksheet("Feb Detail")!;

    // Row 10: Totals — the only bottom-line row now (no separate "Base subtotal").
    const thisPeriod = summary.getRow(10).getCell(4).value as number;
    const reimbursable = detail
      .getRow(detail.rowCount)
      .getCell(columnOf(detail, "Reimbursable Amount")).value as number;

    expect(reimbursable).toBe(thisPeriod);
    expect(reimbursable).toBe(93464.96);
  });

  it("totals the money columns", async () => {
    const sheet = (await open()).getWorksheet("Feb Detail")!;
    const totals = sheet.getRow(sheet.rowCount);
    expect(totals.getCell(4).value).toBe("Totals");
    expect(totals.getCell(columnOf(sheet, "Subtotal")).value).toBe(93464.96);
    expect(totals.getCell(columnOf(sheet, "Tax")).value).toBe(12.34);
    expect(totals.getCell(columnOf(sheet, "Receipt Total")).value).toBe(93477.3);
    expect(totals.getCell(columnOf(sheet, "Reimbursable Amount")).font?.bold).toBe(true);
  });

  it("writes a name beginning with = as text, never as a formula", async () => {
    const sheet = (await open()).getWorksheet("Feb Detail")!;
    const cell = sheet.getRow(2).getCell(2);
    expect(cell.value).toBe("=cmd|calc");
    // A formula cell would surface as an object with a `formula` property.
    expect(typeof cell.value).toBe("string");
    expect(cell.numFmt).toBe("@");
  });

  it("formats dates the way the packet does", async () => {
    const sheet = (await open()).getWorksheet("Feb Detail")!;
    expect(sheet.getRow(2).getCell(1).value).toBe("2/2/2026");
  });
});

describe("filename (R10.3)", () => {
  it("underscores the document name and month", () => {
    expect(summaryWorkbookName("Team Pursuit", FEB)).toBe(
      "Team_Pursuit_February_2026_Summary.xlsx",
    );
  });

  it("strips path separators and collapses the gaps they leave", () => {
    // `.` and `-` survive on purpose — they are legal in filenames and carry meaning in
    // names like "St. Mary-Ann". `/` and `&` do not.
    expect(summaryWorkbookName("Team/Pursuit & Co.", FEB)).toBe(
      "TeamPursuit_Co._February_2026_Summary.xlsx",
    );
  });

  it("falls back to a usable name when the organisation has none", () => {
    expect(summaryWorkbookName("", FEB)).toBe("Organisation_February_2026_Summary.xlsx");
  });
});
