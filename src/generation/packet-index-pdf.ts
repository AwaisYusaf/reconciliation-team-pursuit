import "server-only";

/**
 * The packet's expense index — section 1b, drawn as vector text.
 *
 * A contents page: every expense in the month with its reference, so a reviewer holding a
 * receipt can find what it belongs to, and anyone quoting `2026-02-014` in an email is
 * naming something the packet itself defines.
 *
 * The reference also appears in the footer of every page documenting that one expense, which
 * the funder approved (D-70). It is still never added to the cover sheet's three-column
 * table: that is the layout they signed off, and neither gains a column nor has its text
 * edited. An index page is additive — it takes nothing away and alters nothing agreed.
 *
 * Pure: takes a snapshot, returns bytes.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { Rect } from "./pdf-links";

import { formatDateUS, monthLabel } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { reimbursableCents } from "@/src/domain/money";
import { expenseReference, packetIndexTitle } from "@/src/domain/strings";

import { PACKET_MARGIN_IN, inchesToPoints } from "./layout-constants";
import type { MonthSnapshot } from "./month-snapshot";
import { winAnsiSafe } from "./pdf-text";

const PAGE_WIDTH = inchesToPoints(8.5);
const PAGE_HEIGHT = inchesToPoints(11);
const MARGIN = inchesToPoints(PACKET_MARGIN_IN);
/** The width the columns must sum to; asserted in the tests rather than derived here. */
export const INDEX_CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const BLACK = rgb(0, 0, 0);
const HEADER_FILL = rgb(0.945, 0.925, 0.886);
const LINE = rgb(0.85, 0.82, 0.77);

const TITLE_SIZE = 14;
const SUBTITLE_SIZE = 9;
const HEADER_SIZE = 7.5;
const BODY_SIZE = 9;
const ROW_HEIGHT = 18;
const HEADER_HEIGHT = 22;
const CELL_PAD = 4;
const NOTE_SIZE = 8.5;

/** Break a line to fit the content width — a disclosure must not run off the page. */
function wrapToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = winAnsiSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/** Five columns summing to `INDEX_CONTENT_WIDTH` (7.5in at a 0.5in margin). */
export const INDEX_COLUMNS = [
  { label: "Ref", width: 78, align: "left" as const },
  { label: "Date", width: 62, align: "left" as const },
  { label: "Name", width: 190, align: "left" as const },
  { label: "Line Item", width: 130, align: "left" as const },
  { label: "Reimbursable", width: 80, align: "right" as const },
];

type Fonts = { regular: PDFFont; bold: PDFFont };

/** Truncate to fit rather than wrap: one expense per line keeps the index scannable. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const safe = winAnsiSafe(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;

  const ellipsis = "…";
  let cut = safe;
  while (cut.length > 1 && font.widthOfTextAtSize(cut + ellipsis, size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut + ellipsis;
}

function drawRow(
  page: PDFPage,
  top: number,
  values: string[],
  fonts: Fonts,
  options: { bold?: boolean; fill?: boolean; size?: number } = {},
): number {
  const size = options.size ?? BODY_SIZE;
  const font = options.bold ? fonts.bold : fonts.regular;
  const height = options.fill ? HEADER_HEIGHT : ROW_HEIGHT;
  const bottom = top - height;

  let x = MARGIN;
  INDEX_COLUMNS.forEach((column, index) => {
    if (options.fill) {
      page.drawRectangle({ x, y: bottom, width: column.width, height, color: HEADER_FILL });
    }
    page.drawRectangle({
      x,
      y: bottom,
      width: column.width,
      height,
      borderColor: LINE,
      borderWidth: 0.5,
    });

    const text = fit(values[index] ?? "", font, size, column.width - CELL_PAD * 2);
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: column.align === "right" ? x + column.width - CELL_PAD - textWidth : x + CELL_PAD,
      y: bottom + (height - size) / 2 + 1,
      size,
      font,
      color: BLACK,
    });
    x += column.width;
  });

  return bottom;
}

/**
 * Build the index. Always at least one page, even for a month with no expenses — a packet
 * that silently skips a section it says it has is worse than one that says "none".
 */
/**
 * Where the index's clickable things are, in the index's own page numbering (D-83).
 *
 * Recorded while drawing, because that is when the cell rectangles exist; the packet
 * translates the page numbers once it knows where the index landed.
 */
export type IndexAnchors = {
  /** The `Ref` cell of every row, in row order. */
  refCells: Array<{ reference: string; page: number; rect: Rect }>;
  /** The first line of each no-receipt disclosure (D-74), the index's target for that expense. */
  disclosures: Array<{ reference: string; page: number; rect: Rect; top: number }>;
};

export async function buildIndexSectionPdf(snapshot: MonthSnapshot): Promise<Buffer> {
  return (await buildIndexSection(snapshot)).pdf;
}

export async function buildIndexSection(
  snapshot: MonthSnapshot,
): Promise<{ pdf: Buffer; anchors: IndexAnchors }> {
  const anchors: IndexAnchors = { refCells: [], disclosures: [] };
  let pageIndex = 0;
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const label = monthLabel(snapshot.month);

  const lineItemName = new Map(snapshot.lineItems.map((item) => [item.id, item.name]));

  // Reference order, which is entry order — the same sequence the cover sheets and the rest
  // of the packet use, so the index reads as a table of contents rather than a re-sort.
  const ordered = [...snapshot.expenses].sort((a, b) => a.referenceSeq - b.referenceSeq);

  /**
   * Expenses that contribute no page to the packet (R4.4).
   *
   * Their reference appears in this index and on no page anywhere, because there is no
   * evidence to stamp it on. Left unexplained, that reads as a missing document; stated
   * here, it is the disclosure the funder already accepted on the cover sheet. Without it
   * the trail this index exists to close simply stops (D-74).
   */
  const undocumented = ordered.filter((expense) => expense.noReceipt);

  const rows = ordered
    .map((expense) => [
      expenseReference(snapshot.month, expense.referenceSeq),
      formatDateUS(expense.date),
      expense.name,
      lineItemName.get(expense.lineItemId) ?? "",
      formatMoney(reimbursableCents(expense)),
    ]);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const startPage = (withTitle: boolean) => {
    if (withTitle) {
      page.drawText(winAnsiSafe(packetIndexTitle(snapshot.docName, label)), {
        x: MARGIN,
        y: y - TITLE_SIZE,
        size: TITLE_SIZE,
        font: fonts.bold,
        color: BLACK,
      });
      y -= TITLE_SIZE + 8;
      page.drawText(
        winAnsiSafe(
          `${rows.length} expense${rows.length === 1 ? "" : "s"} · every receipt, invoice and proof of payment in this packet is filed under its reference below`,
        ),
        { x: MARGIN, y: y - SUBTITLE_SIZE, size: SUBTITLE_SIZE, font: fonts.regular, color: BLACK },
      );
      y -= SUBTITLE_SIZE + 14;
    }
    y = drawRow(page, y, INDEX_COLUMNS.map((column) => column.label), fonts, {
      bold: true,
      fill: true,
      size: HEADER_SIZE,
    });
  };

  startPage(true);

  if (rows.length === 0) {
    page.drawText(winAnsiSafe("This month has no expenses."), {
      x: MARGIN,
      y: y - 18,
      size: BODY_SIZE,
      font: fonts.regular,
      color: BLACK,
    });
  }

  for (const row of rows) {
    // The header is repeated on every page: a continuation sheet of bare figures with no
    // column names is unreadable on its own, and packet pages get separated.
    if (y - ROW_HEIGHT < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pageIndex += 1;
      y = PAGE_HEIGHT - MARGIN;
      startPage(false);
    }
    anchors.refCells.push({
      reference: row[0],
      page: pageIndex,
      rect: { x: MARGIN, y: y - ROW_HEIGHT, width: INDEX_COLUMNS[0].width, height: ROW_HEIGHT },
    });
    y = drawRow(page, y, row, fonts);
  }

  for (const expense of undocumented) {
    const reason = expense.noReceiptReason?.trim();
    // Worded like the cover sheet heading and its note (D-113), so the two read the same.
    const line = `${expense.name} (${expenseReference(snapshot.month, expense.referenceSeq)}): no receipt available${reason ? `. Reason: ${reason}` : ""}`;
    const wrapped = wrapToWidth(line, fonts.regular, NOTE_SIZE, INDEX_CONTENT_WIDTH);

    // Height of the block plus its heading, so a disclosure is never split from its list.
    const needed = wrapped.length * (NOTE_SIZE + 3) + (expense === undocumented[0] ? 26 : 0);
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pageIndex += 1;
      y = PAGE_HEIGHT - MARGIN;
    }

    if (expense === undocumented[0]) {
      y -= 16;
      page.drawText(
        winAnsiSafe("These expenses carry no supporting document, for the reason stated:"),
        { x: MARGIN, y, size: NOTE_SIZE, font: fonts.bold, color: BLACK },
      );
      y -= 14;
    }

    // The first line is the target: a glyph box around the baseline, and a `top` that puts
    // the line at the top of the viewport.
    anchors.disclosures.push({
      reference: expenseReference(snapshot.month, expense.referenceSeq),
      page: pageIndex,
      rect: { x: MARGIN, y: y - 3, width: INDEX_CONTENT_WIDTH, height: NOTE_SIZE + 4 },
      top: y + NOTE_SIZE + 6,
    });
    for (const text of wrapped) {
      page.drawText(winAnsiSafe(text), {
        x: MARGIN,
        y,
        size: NOTE_SIZE,
        font: fonts.regular,
        color: BLACK,
      });
      y -= NOTE_SIZE + 3;
    }
  }

  return { pdf: Buffer.from(await pdf.save()), anchors };
}
