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

/** 10 pt line plus 6 pt of paragraph spacing, converted to 96-DPI pixels. */
const LINE_PX = Math.round(((10 + 6) * 96) / 72);
/** The title's 1.5 pt rule sits 6 pt under it (D-137); it moves the table down by both. */
const TITLE_RULE_PX = Math.round(((1.5 + 6) * 96) / 72);
const TITLE_PX = Math.round(((12 + 6) * 96) / 72) + 16 + TITLE_RULE_PX;
const TABLE_HEADER_PX = 34;
const TABLE_ROW_PX = 30;
const IMAGE_GAP_PX = 8;
const HEADING_BEFORE_PX = 16;

/**
 * Characters that fit on one line of the Role column at 10 pt.
 *
 * The column is 58% of a 6.5" text width; Aptos averages a little over half the point size
 * per character, so a point smaller fits roughly a tenth more. Approximate on purpose — a row
 * being one line taller than guessed costs a few pixels, well inside the ±2 page tolerance.
 *
 * These move with `BODY_SIZE` *and* with the column widths: leaving them behind would make the
 * estimate drift from the renderer, which is the one thing this module exists not to do. The
 * figure fell from 57 when Role gave 3% of its width to Amount so the total would stop
 * wrapping (D-76) — 57 x 58/61.
 */
const ROLE_CHARS_PER_LINE = 54;
const NARRATIVE_CHARS_PER_LINE = 104;

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
