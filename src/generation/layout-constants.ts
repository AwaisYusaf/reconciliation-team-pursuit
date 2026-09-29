/**
 * Page geometry shared by every generated document.
 *
 * The cover sheet (docx), the packet (pdf-lib) and the on-screen page estimates all measure
 * against these numbers. Kept in one pure module so a change to the margin cannot make the
 * estimate and the real renderer disagree — the cover-sheet spec's acceptance criterion is
 * that they stay within one page of each other.
 */

/** US Letter portrait. */
export const PAGE_WIDTH_IN = 8.5;
export const PAGE_HEIGHT_IN = 11;

/** Cover sheets use 1" margins; the packet uses 0.5" (packet-pdf-spec). */
export const COVER_MARGIN_IN = 1;
export const PACKET_MARGIN_IN = 0.5;

export const COVER_TEXT_WIDTH_IN = PAGE_WIDTH_IN - COVER_MARGIN_IN * 2; // 6.5"
export const COVER_TEXT_HEIGHT_IN = PAGE_HEIGHT_IN - COVER_MARGIN_IN * 2; // 9"

/**
 * The cover sheet table's columns — Name, Role, Amount — as shares of the text width.
 *
 * Read by the Word file and by the on-screen preview, which promises to match it. The preview
 * once kept its own copy and was still drawing the pre-D-76 24/61/15 split a month after the
 * file moved to 24/58/18.
 */
export const COVER_COLUMN_SHARES = [0.24, 0.58, 0.18] as const;

/** Word measures images in pixels at 96 DPI. */
export const DOCX_PIXELS_PER_INCH = 96;

/** PDF user space is 72 units per inch. */
export const POINTS_PER_INCH = 72;

export function inchesToDocxPixels(inches: number): number {
  return Math.round(inches * DOCX_PIXELS_PER_INCH);
}

export function inchesToPoints(inches: number): number {
  return inches * POINTS_PER_INCH;
}

/**
 * Fit an image inside a box, preserving aspect ratio and never enlarging it.
 *
 * Upscaling a small receipt to the full text width would only magnify its compression
 * artefacts, so an image smaller than the box keeps its natural size.
 */
export function fitWithin(
  source: { widthPx: number; heightPx: number },
  box: { widthPx: number; heightPx: number },
): { widthPx: number; heightPx: number } {
  // A zero dimension means the dimensions were never recorded. Filling the box would invent
  // an aspect ratio and stretch the image; a modest square is honest about knowing nothing.
  if (source.widthPx <= 0 || source.heightPx <= 0) {
    const side = Math.min(box.widthPx, box.heightPx);
    return { widthPx: side, heightPx: side };
  }

  const scale = Math.min(box.widthPx / source.widthPx, box.heightPx / source.heightPx, 1);
  return {
    widthPx: Math.max(1, Math.round(source.widthPx * scale)),
    heightPx: Math.max(1, Math.round(source.heightPx * scale)),
  };
}

/**
 * The box a proof image may occupy on a cover sheet.
 *
 * Slightly shorter than the full text height so an image that fills the box still leaves
 * room for the heading above it rather than being pushed onto a page of its own.
 */
export const COVER_IMAGE_BOX = {
  widthPx: inchesToDocxPixels(COVER_TEXT_WIDTH_IN),
  heightPx: inchesToDocxPixels(COVER_TEXT_HEIGHT_IN - 1),
};
