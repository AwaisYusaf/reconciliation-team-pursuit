/**
 * The app's palette as the generated documents use it.
 *
 * One supplier for every generator (the Word cover sheet, the packet's pdf-lib pages) and the
 * on-screen cover sheet preview, so a colour cannot change in the file the City receives
 * without changing in the preview that promises to show it. Values are the design tokens in
 * `app/globals.css` (docs/03-modules/design-language.md); they are repeated here rather than
 * read from CSS because Word and pdf-lib need them as plain hex.
 *
 * Deliberately few: a funder reads, prints and photocopies these pages, so the brown marks
 * the title rule, the table header, the total's rule and the note text, and everything else
 * stays ink on white.
 */
export const DOCUMENT_THEME = {
  /** Body text. */
  ink: "211B16",
  /** Footer and other secondary text. */
  sub: "5B5147",
  /** Table grid lines. */
  line: "D8D0C4",
  /** Table header band, title rule, note text. */
  accent: "5B3A29",
  /** Text on the header band. */
  onAccent: "FFFFFF",
  /** Total row and note tint. */
  section: "F1ECE2",
} as const;

/** `5B3A29` as 0 to 1 channels, for pdf-lib's `rgb()`. */
export function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
