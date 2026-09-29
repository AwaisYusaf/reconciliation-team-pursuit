/**
 * Grid strokes for the tables pdf-lib draws (the packet's summary and index sections).
 */
import type { Color, PDFPage } from "pdf-lib";

/**
 * Stroke a body cell's left, right and bottom edges, leaving its top to the row above.
 *
 * A full rectangle would paint the cell's grey top edge over the header band's brown bottom
 * edge, a hairline under the band (D-137). It is the same rule the Word cover sheet follows
 * with a `nil` top border: every edge is drawn once, by the cell above it.
 */
export function strokeOpenTop(
  page: PDFPage,
  cell: { x: number; y: number; width: number; height: number },
  color: Color,
  thickness = 0.5,
): void {
  const { x, y, width, height } = cell;
  const top = y + height;
  const right = x + width;
  page.drawLine({ start: { x, y }, end: { x: right, y }, thickness, color });
  page.drawLine({ start: { x, y }, end: { x, y: top }, thickness, color });
  page.drawLine({ start: { x: right, y }, end: { x: right, y: top }, thickness, color });
}
