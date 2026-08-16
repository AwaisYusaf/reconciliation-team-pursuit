/**
 * Section 1 of the packet — the contract summary, drawn as vector text.
 *
 * Kept as real text rather than a rasterised copy of the workbook so it stays selectable,
 * searchable and a few kilobytes rather than a megabyte. The figures come from the same
 * calculation service the workbook and the screen use, so all three agree (R10.2).
 *
 * Pure: takes a snapshot, returns bytes.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { contractContextLine } from "@/src/domain/contract-context";
import { monthLabel } from "@/src/domain/dates";
import { formatMoney, formatPercent } from "@/src/domain/format";
import { packetSummaryTitle } from "@/src/domain/strings";
import { contractSummary, type SummaryRow } from "@/src/domain/summary";

import { PACKET_MARGIN_IN, inchesToPoints } from "./layout-constants";
import { winAnsiSafe } from "./pdf-text";
import type { MonthSnapshot } from "./month-snapshot";

const PAGE_WIDTH = inchesToPoints(8.5);
const PAGE_HEIGHT = inchesToPoints(11);
const MARGIN = inchesToPoints(PACKET_MARGIN_IN);
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const YELLOW = rgb(1, 1, 0);
const SECTION_FILL = rgb(0.945, 0.925, 0.886);
const BLACK = rgb(0, 0, 0);

const TITLE_SIZE = 16;
const SUBTITLE_SIZE = 9;
const HEADER_SIZE = 7.5;
const BODY_SIZE = 9;
const ROW_HEIGHT = 20;
const HEADER_HEIGHT = 26;
const CELL_PAD = 4;

/** Seven columns summing to the content width. */
const COLUMNS = [
  { label: "Description of Work", width: 150, align: "left" as const },
  { label: "Scheduled Value", width: 68, align: "right" as const },
  { label: "Previously Billed", width: 68, align: "right" as const },
  { label: "This Period", width: 62, align: "right" as const },
  { label: "Total Billed to Date", width: 70, align: "right" as const },
  { label: "% Complete", width: 52, align: "right" as const },
  { label: "Balance to Finish", width: 70, align: "right" as const },
];

type Fonts = { regular: PDFFont; bold: PDFFont };

/** Break text into lines that fit a width, so a long line item name never overruns its cell. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function drawCellText(
  page: PDFPage,
  rawText: string,
  options: {
    x: number;
    y: number;
    width: number;
    align: "left" | "right";
    font: PDFFont;
    size: number;
  },
): void {
  const text = winAnsiSafe(rawText);
  const textWidth = options.font.widthOfTextAtSize(text, options.size);
  const x =
    options.align === "right"
      ? options.x + options.width - CELL_PAD - textWidth
      : options.x + CELL_PAD;

  page.drawText(text, { x, y: options.y, size: options.size, font: options.font, color: BLACK });
}

/** A bordered row of cells; `values` is index-aligned with COLUMNS. */
function drawRow(
  page: PDFPage,
  top: number,
  values: string[],
  fonts: Fonts,
  options: { bold?: boolean; fill?: ReturnType<typeof rgb>; size?: number } = {},
): number {
  const size = options.size ?? BODY_SIZE;
  const font = options.bold ? fonts.bold : fonts.regular;

  // A long name wraps, and the row grows to hold it rather than overprinting its neighbour.
  const nameLines = wrap(values[0] ?? "", font, size, COLUMNS[0].width - CELL_PAD * 2);
  const height = Math.max(ROW_HEIGHT, nameLines.length * (size + 3) + CELL_PAD * 2);
  const bottom = top - height;

  let x = MARGIN;
  COLUMNS.forEach((column, index) => {
    if (options.fill) {
      page.drawRectangle({ x, y: bottom, width: column.width, height, color: options.fill });
    }
    page.drawRectangle({
      x,
      y: bottom,
      width: column.width,
      height,
      borderColor: BLACK,
      borderWidth: 0.5,
    });

    const value = values[index] ?? "";
    if (index === 0) {
      nameLines.forEach((line, lineIndex) => {
        drawCellText(page, line, {
          x,
          y: top - CELL_PAD - size - lineIndex * (size + 3),
          width: column.width,
          align: column.align,
          font,
          size,
        });
      });
    } else if (value) {
      drawCellText(page, value, {
        x,
        y: bottom + (height - size) / 2 + 1,
        width: column.width,
        align: column.align,
        font,
        size,
      });
    }

    x += column.width;
  });

  return bottom;
}

/** A merged, shaded divider spanning the table. */
function drawSectionRow(page: PDFPage, top: number, rawLabel: string, fonts: Fonts): number {
  const label = winAnsiSafe(rawLabel);
  const height = ROW_HEIGHT;
  const bottom = top - height;

  page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: CONTENT_WIDTH,
    height,
    color: SECTION_FILL,
    borderColor: BLACK,
    borderWidth: 0.5,
  });
  page.drawText(label, {
    x: MARGIN + CELL_PAD,
    y: bottom + (height - HEADER_SIZE) / 2 + 1,
    size: HEADER_SIZE,
    font: fonts.bold,
    color: BLACK,
  });

  return bottom;
}

function drawTableHeader(page: PDFPage, top: number, fonts: Fonts): number {
  const bottom = top - HEADER_HEIGHT;
  let x = MARGIN;

  for (const column of COLUMNS) {
    page.drawRectangle({
      x,
      y: bottom,
      width: column.width,
      height: HEADER_HEIGHT,
      color: YELLOW,
      borderColor: BLACK,
      borderWidth: 0.5,
    });

    // Headers wrap to two lines rather than being truncated.
    const lines = wrap(column.label, fonts.bold, HEADER_SIZE, column.width - CELL_PAD * 2);
    lines.forEach((line, index) => {
      drawCellText(page, line, {
        x,
        y: top - CELL_PAD - HEADER_SIZE - index * (HEADER_SIZE + 2),
        width: column.width,
        align: column.align,
        font: fonts.bold,
        size: HEADER_SIZE,
      });
    });

    x += column.width;
  }

  return bottom;
}

function rowValues(row: SummaryRow): string[] {
  return [
    row.name,
    formatMoney(row.scheduledCents),
    formatMoney(row.previouslyBilledCents),
    formatMoney(row.thisPeriodCents),
    formatMoney(row.totalBilledCents),
    formatPercent(row.percentComplete),
    formatMoney(row.balanceCents),
  ];
}

/** Build the packet's contract summary section. */
export async function buildSummarySectionPdf(snapshot: MonthSnapshot): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  const label = monthLabel(snapshot.month);
  const summary = contractSummary({
    lineItems: snapshot.lineItems,
    expenses: snapshot.amounts,
    settings: snapshot.settings,
    month: snapshot.month,
  });

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const title = winAnsiSafe(packetSummaryTitle(snapshot.docName, label));
  page.drawText(title, {
    x: MARGIN + (CONTENT_WIDTH - fonts.bold.widthOfTextAtSize(title, TITLE_SIZE)) / 2,
    y: y - TITLE_SIZE,
    size: TITLE_SIZE,
    font: fonts.bold,
    color: BLACK,
  });
  y -= TITLE_SIZE + 12;

  // One subtitle line carrying the R7.3 context, empty settings omitted.
  const context = winAnsiSafe(
    contractContextLine(
    {
      contractNumber: snapshot.settings.contractNumber,
      basePoNumber: snapshot.settings.basePoNumber,
      performancePoNumber: snapshot.settings.performancePoNumber,
      contractValueCents: snapshot.settings.contractValueCents,
      scheduledTotalCents: summary.totals.scheduledCents,
    },
      snapshot.month,
    ),
  );
  // A fully populated context line is wider than the page, and centring an over-wide string
  // pushes it past the margin and eventually off the sheet entirely, so it wraps instead.
  const contextLines = wrap(context, fonts.regular, SUBTITLE_SIZE, CONTENT_WIDTH);
  for (const line of contextLines) {
    page.drawText(line, {
      x: MARGIN + (CONTENT_WIDTH - fonts.regular.widthOfTextAtSize(line, SUBTITLE_SIZE)) / 2,
      y: y - SUBTITLE_SIZE,
      size: SUBTITLE_SIZE,
      font: fonts.regular,
      color: rgb(0.35, 0.32, 0.28),
    });
    y -= SUBTITLE_SIZE + 3;
  }
  y -= 15;

  y = drawTableHeader(page, y, fonts);

  /** Start a new page and repeat the header, so every page's table is readable alone. */
  const ensureSpace = (needed: number) => {
    if (y - needed >= MARGIN + 24) return;
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = drawTableHeader(page, PAGE_HEIGHT - MARGIN, fonts);
  };

  ensureSpace(ROW_HEIGHT);
  y = drawSectionRow(page, y, "BASE", fonts);

  for (const row of summary.baseRows) {
    ensureSpace(ROW_HEIGHT * 2);
    y = drawRow(page, y, rowValues(row), fonts);
  }

  ensureSpace(ROW_HEIGHT);
  y = drawRow(page, y, rowValues(summary.baseSubtotal), fonts, { bold: true });

  ensureSpace(ROW_HEIGHT * 2);
  y = drawSectionRow(page, y, "PERFORMANCE GRANT 1", fonts);
  y = drawRow(page, y, rowValues(summary.performanceRow), fonts);

  ensureSpace(ROW_HEIGHT);
  y = drawRow(page, y, rowValues(summary.totals), fonts, { bold: true });

  // Reconciliation: label left, value right, no grid — the same four lines as the screen.
  y -= 24;
  const reconciliation: Array<[string, string]> = [
    ["Total advances received", formatMoney(summary.reconciliation.advancesCents)],
    ["Total reconciled to date", formatMoney(summary.reconciliation.reconciledCents)],
    ["Balance remaining to reconcile", formatMoney(summary.reconciliation.balanceCents)],
    [
      "Percentage of advance payments reconciled",
      formatPercent(summary.reconciliation.percentReconciled),
    ],
  ];

  for (const [labelText, value] of reconciliation) {
    ensureSpace(18);
    page.drawText(winAnsiSafe(labelText), {
      x: MARGIN,
      y: y - BODY_SIZE,
      size: BODY_SIZE,
      font: fonts.regular,
      color: BLACK,
    });
    const valueWidth = fonts.bold.widthOfTextAtSize(value, BODY_SIZE);
    page.drawText(value, {
      x: MARGIN + 300 - valueWidth,
      y: y - BODY_SIZE,
      size: BODY_SIZE,
      font: fonts.bold,
      color: BLACK,
    });
    y -= 18;
  }

  return Buffer.from(await pdf.save());
}
