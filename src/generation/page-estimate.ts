/**
 * Live page counts for the packet contents listing (m06, packet-pdf-spec §Screen).
 *
 * Pure, and measured against the same `layout-constants` the real renderer uses, so the
 * number the user reads before downloading and the number of pages they get stay in step —
 * the spec's tolerance is ±2 pages per sheet.
 *
 * This simulates the document's vertical flow rather than applying a formula, because the
 * thing that actually drives the count is where the page breaks fall.
 */
import { COVER_IMAGE_BOX, COVER_TEXT_HEIGHT_IN, inchesToDocxPixels, fitWithin } from "./layout-constants";

/** Usable height of one cover sheet page, in the same 96-DPI pixels images are measured in. */
const PAGE_HEIGHT_PX = inchesToDocxPixels(COVER_TEXT_HEIGHT_IN);

/** 11 pt line plus 6 pt of paragraph spacing, converted to 96-DPI pixels. */
const LINE_PX = Math.round(((11 + 6) * 96) / 72);
const TITLE_PX = Math.round(((12 + 6) * 96) / 72) + 16;
const TABLE_HEADER_PX = 34;
const TABLE_ROW_PX = 30;
const IMAGE_GAP_PX = 8;
const HEADING_BEFORE_PX = 16;

/**
 * Characters that fit on one line of the Role column at 11 pt.
 *
 * The column is 61% of a 6.5" text width; Aptos averages a little over half the point size
 * per character. Approximate on purpose — a row being one line taller than guessed costs a
 * few pixels, well inside the ±2 page tolerance.
 */
const ROLE_CHARS_PER_LINE = 52;
const NARRATIVE_CHARS_PER_LINE = 95;

export type EstimateRow = {
  role: string;
  notes: string[];
  narrative: string | null;
  /** Stored dimensions of each proof; a PDF proof contributes one entry per page. */
  proofs: { widthPx: number; heightPx: number }[];
};

function linesFor(text: string, charsPerLine: number): number {
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

/**
 * Pages one cover sheet will occupy.
 *
 * Walks the document in the order `cover-sheet-docx.ts` emits it, breaking to a new page
 * whenever the next block does not fit.
 */
export function estimateCoverSheetPages(rows: readonly EstimateRow[]): number {
  if (rows.length === 0) return 1;

  let pages = 1;
  let used = TITLE_PX + LINE_PX + TABLE_HEADER_PX;

  const place = (height: number) => {
    // A block taller than a whole page still occupies one page of its own.
    if (used + height > PAGE_HEIGHT_PX && used > 0) {
      pages += 1;
      used = 0;
    }
    used += height;
  };

  for (const row of rows) {
    place(TABLE_ROW_PX * linesFor(row.role, ROLE_CHARS_PER_LINE));
  }
  // Total row, then the canonical sentence.
  place(TABLE_ROW_PX);
  place(LINE_PX * 2);

  for (const row of rows) {
    const notesLength = row.notes.join(" ").length;
    place(HEADING_BEFORE_PX + LINE_PX * linesFor(notesLength ? `x${notesLength}` : "x", 90));

    if (row.narrative) {
      place(LINE_PX * linesFor(row.narrative, NARRATIVE_CHARS_PER_LINE));
    }

    for (const proof of row.proofs) {
      place(fitWithin(proof, COVER_IMAGE_BOX).heightPx + IMAGE_GAP_PX);
    }
  }

  return pages;
}

/**
 * Pages an uploaded file contributes: one packet page per source page.
 *
 * `pageCount` is filled at attach time; a null means processing never completed, and one
 * page is the honest floor rather than zero.
 */
export function estimateUploadPages(documents: readonly { pageCount: number | null }[]): number {
  return documents.reduce((total, document) => total + (document.pageCount ?? 1), 0);
}
