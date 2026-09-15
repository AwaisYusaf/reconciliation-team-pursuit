/**
 * Contract summary workbook — implements docs/02-outputs/summary-excel-spec.md.
 *
 * Pure: takes a month snapshot, returns bytes. Money is written as numeric dollar values
 * with a US-pinned currency format and percentages as fractions with `0%`, never as
 * preformatted strings, so the workbook the City receives stays computable. User-entered text
 * is always written as an explicit string cell, so a leading `=` can never become a formula.
 */
import ExcelJS from "exceljs";

import { monthLabel, monthShortLabel, formatDateUS, type MonthKey } from "@/src/domain/dates";
import { percentValue, summaryRowLabel } from "@/src/domain/format";
import { centsToDollars, receiptTotalCents, reimbursableCents, sumBy } from "@/src/domain/money";
import { summaryFilename } from "@/src/domain/strings";
import { contractSummary, type SummaryRow } from "@/src/domain/summary";

import type { MonthSnapshot } from "./month-snapshot";

const YELLOW = "FFFFFF00";
const SECTION = "FFF1ECE2";
/**
 * US dollars, pinned to locale 409 (en-US) rather than written as a bare `"$"`.
 *
 * A quoted `"$"` is treated by Numbers and LibreOffice as "the system currency symbol", so
 * the same file rendered as `HK$523,162.97` on a reader whose region was set to Hong Kong.
 * The stored numbers were always correct — only the symbol was localised — but this workbook
 * is submitted to the City, and the machine it is opened on is not ours to configure.
 */
const MONEY_FORMAT = "[$$-409]#,##0.00";
const PERCENT_FORMAT = "0%";

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF000000" } },
  left: { style: "thin", color: { argb: "FF000000" } },
  bottom: { style: "thin", color: { argb: "FF000000" } },
  right: { style: "thin", color: { argb: "FF000000" } },
};

/**
 * A percentage as the fraction Excel's `0%` format expects, pre-rounded by R1.5.
 *
 * The rounding happens here rather than being left to Excel so that the workbook and the
 * Contract Summary screen cannot print different numbers for the same data (R10.2) — the
 * two renderers do not have to agree on a rounding rule if only one of them rounds.
 */
function percentCell(ratio: number): number {
  return percentValue(ratio) / 100;
}

/** Write user text as an explicit string so a leading `=` is never treated as a formula. */
function textCell(cell: ExcelJS.Cell, value: string): void {
  cell.value = value ?? "";
  cell.numFmt = "@";
}

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
    cell.border = THIN_BORDER;
  });
}

/**
 * A merged, shaded divider spanning the table.
 *
 * Borders go on every cell of the span, not just the first: the spec puts these rows inside
 * the bordered range, and an unbordered merged row leaves a visible gap in the grid.
 */
function addSectionRow(sheet: ExcelJS.Worksheet, label: string): void {
  const row = sheet.addRow([label]);
  for (let column = 1; column <= 7; column += 1) {
    row.getCell(column).border = THIN_BORDER;
  }
  row.getCell(1).font = { bold: true };
  row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION } };
  sheet.mergeCells(row.number, 1, row.number, 7);
}

function summaryValues(row: SummaryRow): [string, number, number, number, number, number, number] {
  return [
    summaryRowLabel(row.name, row.performanceCents),
    centsToDollars(row.scheduledCents),
    centsToDollars(row.previouslyBilledCents),
    centsToDollars(row.thisPeriodCents),
    centsToDollars(row.totalBilledCents),
    percentCell(row.percentComplete),
    centsToDollars(row.balanceCents),
  ];
}

function formatSummaryRow(row: ExcelJS.Row, bold = false): void {
  row.eachCell((cell, column) => {
    cell.border = THIN_BORDER;
    if (bold) cell.font = { bold: true };
    // Column A's 34-character width is fixed by the spec, but the split annotation (D-82,
    // e.g. "Development Desiging (includes $63,000.00 performance)") routinely runs past it —
    // wrapped rather than clipped, the way Excel and LibreOffice both size the row for on open.
    if (column === 1) cell.alignment = { wrapText: true };
    if (column >= 2 && column <= 5) cell.numFmt = MONEY_FORMAT;
    if (column === 6) cell.numFmt = PERCENT_FORMAT;
    if (column === 7) cell.numFmt = MONEY_FORMAT;
  });
}

/** Build the workbook for one month. */
export async function buildSummaryWorkbook(snapshot: MonthSnapshot): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = snapshot.docName || "Grant Expense Reconciliation";

  const summary = contractSummary({
    lineItems: snapshot.lineItems,
    expenses: snapshot.amounts,
    settings: snapshot.settings,
    month: snapshot.month,
  });

  /* ------------------------------------------------- sheet 1: Contract Summary */

  const sheet = workbook.addWorksheet("Contract Summary");
  sheet.columns = [
    { width: 34 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
    { width: 18 },
    { width: 12 },
    { width: 16 },
  ];

  const header = sheet.addRow([
    "Description of Work",
    "Scheduled Value",
    "Previously Billed",
    "This Period",
    "Total Billed to Date",
    "% Complete",
    "Balance to Finish",
  ]);
  styleHeader(header);

  addSectionRow(sheet, "BASE");

  for (const row of summary.baseRows) {
    const added = sheet.addRow(summaryValues(row));
    textCell(added.getCell(1), summaryRowLabel(row.name, row.performanceCents));
    formatSummaryRow(added);
  }

  // No separate "Base subtotal" row: every line item is a base row now that performances
  // (m08) replaced the old Performance Grant section, so it would only ever repeat Totals.
  // performanceCents zeroed for display only: the split annotation belongs to an individual
  // line item, not this aggregate row (see the same note in contract-summary/page.tsx).
  const totals = sheet.addRow(summaryValues({ ...summary.totals, performanceCents: 0 }));
  formatSummaryRow(totals, true);

  sheet.addRow([]);

  // Reconciliation: labels in column A, values in column B, no borders or fill.
  const reconciliation: Array<[string, number, string]> = [
    ["Total advances received", centsToDollars(summary.reconciliation.advancesCents), MONEY_FORMAT],
    ["Total reconciled to date", centsToDollars(summary.reconciliation.reconciledCents), MONEY_FORMAT],
    ["Balance remaining to reconcile", centsToDollars(summary.reconciliation.balanceCents), MONEY_FORMAT],
    [
      "Percentage of advance payments reconciled",
      percentCell(summary.reconciliation.percentReconciled),
      PERCENT_FORMAT,
    ],
  ];
  for (const [label, value, format] of reconciliation) {
    const row = sheet.addRow([label, value]);
    textCell(row.getCell(1), label);
    row.getCell(2).numFmt = format;
  }

  /* ------------------------------------------------------ sheet 2: {Mon} Detail */

  const detail = workbook.addWorksheet(`${monthShortLabel(snapshot.month)} Detail`);
  detail.columns = [
    { width: 12 },
    { width: 24 },
    { width: 24 },
    { width: 55 },
    { width: 30 },
    { width: 12 },
    { width: 10 },
    { width: 10 },
    { width: 14 },
    { width: 18 },
  ];

  const detailHeader = detail.addRow([
    "Date",
    "Name",
    "Line Item",
    "Description",
    "Payment Source",
    "Subtotal",
    "Tax",
    "Fees",
    "Receipt Total",
    "Reimbursable Amount",
  ]);
  styleHeader(detailHeader);

  // Grouped by line item, then by entry order within it, matching the packet's sections.
  const ordered = [...snapshot.expenses].sort((a, b) => {
    const itemA = snapshot.lineItems.findIndex((item) => item.id === a.lineItemId);
    const itemB = snapshot.lineItems.findIndex((item) => item.id === b.lineItemId);
    return itemA - itemB || a.sortOrder - b.sortOrder;
  });

  for (const expense of ordered) {
    const row = detail.addRow([
      formatDateUS(expense.date),
      expense.name,
      expense.lineItemName,
      expense.description,
      expense.paymentSource,
      centsToDollars(expense.subtotalCents),
      centsToDollars(expense.taxCents),
      centsToDollars(expense.feesCents),
      // What the receipt says, next to what is claimed from it. With tax and fees now
      // optionally reimbursable, the gap between these two columns is the thing a reviewer
      // reconciling against the attached document actually needs to see (R1.3).
      centsToDollars(receiptTotalCents(expense)),
      centsToDollars(reimbursableCents(expense)),
    ]);
    for (const column of [1, 2, 3, 4, 5]) textCell(row.getCell(column), String(row.getCell(column).value ?? ""));
    for (const column of [6, 7, 8, 9, 10]) row.getCell(column).numFmt = MONEY_FORMAT;
  }

  const totalsRow = detail.addRow([
    "",
    "",
    "",
    "Totals",
    "",
    centsToDollars(sumBy(ordered, (expense) => expense.subtotalCents)),
    centsToDollars(sumBy(ordered, (expense) => expense.taxCents)),
    centsToDollars(sumBy(ordered, (expense) => expense.feesCents)),
    centsToDollars(sumBy(ordered, receiptTotalCents)),
    centsToDollars(sumBy(ordered, reimbursableCents)),
  ]);
  totalsRow.eachCell((cell, column) => {
    cell.font = { bold: true };
    if (column >= 6) cell.numFmt = MONEY_FORMAT;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** `{DocName}_{Month}_{YYYY}_Summary.xlsx` — delegates to the canonical helper (R10.3). */
export function summaryWorkbookName(docName: string, month: MonthKey, sourceName?: string | null): string {
  return summaryFilename(docName || "Organisation", monthLabel(month), sourceName);
}
