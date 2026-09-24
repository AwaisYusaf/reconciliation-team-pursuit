/**
 * Formatting — the only place money and percentages become strings (domain-rules R1.2, R1.5).
 *
 * Both the UI and the document generators call these, so a cover sheet, the dashboard,
 * the Excel summary and the packet can never disagree about how a number reads.
 */

const MONEY = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format integer cents as `$#,##0.00` (R1.2).
 * Negatives lead with the sign: `-$145.00`. Never returns a bare number.
 */
export function formatMoney(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}$${MONEY.format(Math.abs(rounded) / 100)}`;
}

/**
 * {@link formatMoney} split at the decimal point, for the dashboard's hero figures, which
 * set the cents smaller than the dollars so a long grant total stays readable at a glance.
 *
 * Splits the formatted string rather than formatting the two parts separately: rounding,
 * grouping and the leading sign are then decided exactly once, in `formatMoney`, and the
 * halves cannot disagree with the same figure printed anywhere else (R1.2, R10.2).
 * `formatMoney` always emits two fraction digits, so the separator is always present.
 */
export function splitMoney(cents: number): { whole: string; fraction: string } {
  const text = formatMoney(cents);
  const point = text.lastIndexOf(".");
  return { whole: text.slice(0, point), fraction: text.slice(point) };
}

/**
 * Format a ratio (0.8625) as a whole-number percentage string (`86%`), rounded
 * half away from zero (R1.5). Non-finite input — including division by zero — is `0%`.
 */
export function formatPercent(ratio: number): string {
  return `${percentValue(ratio)}%`;
}

/**
 * The numeric whole-number percentage behind {@link formatPercent}, for callers that
 * need the value rather than the string (e.g. comparisons in tests).
 */
export function percentValue(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return roundHalfAwayFromZero(normalizeFloatError(ratio * 100));
}

/**
 * Collapse binary representation error before rounding.
 *
 * A ratio of exactly 57.5% arrives here as 57.49999999999999289, because neither 0.575 nor
 * the division that produced it is exact in binary. Rounding that directly gives 57 where
 * R1.5 requires 58 — and Excel, which normalises to 15 significant digits before it rounds
 * for display, would print 58 in the same cell. Matching Excel's normalisation keeps the
 * screen and the workbook showing the same number (R10.2) and makes R1.5's half-away-from-
 * zero rule apply to the value the user means rather than to its floating-point shadow.
 */
function normalizeFloatError(value: number): number {
  return Number(value.toPrecision(15));
}

/**
 * Safe ratio helper: returns 0 when the denominator is 0, matching R1.5's
 * "division by zero → 0%" rule rather than producing Infinity or NaN.
 */
export function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/** Round half away from zero: 0.5 → 1, -0.5 → -1 (R1.5). JS `Math.round` rounds -0.5 to 0. */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/**
 * Human-readable byte size for the `/a` storage bar (Phase 9 §5, §6): `"0 B"`, `"512 B"`,
 * `"212 MB"`, `"5 GB"`, `"4.8 GB"`. Negative or non-finite input is `"0 B"`, matching
 * `formatPercent`'s defensive floor.
 *
 * Rounding runs before the unit is chosen, not after, so a value that rounds up into the next
 * unit (1023.6 MB) prints `"1 GB"` rather than the impossible `"1024 MB"`.
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < KB) return `${Math.round(n)} B`;
  if (Math.round(n / KB) < 1024) return `${Math.round(n / KB)} KB`;
  if (Math.round(n / MB) < 1024) return `${Math.round(n / MB)} MB`;
  const gb = Math.round((n / GB) * 10) / 10;
  return `${gb} GB`;
}

/**
 * A line item's (or the Totals row's) name, annotated with its performance amount when it has
 * one (R7.1, m08) — shared by the Contract Summary screen, the packet PDF and the Excel
 * workbook so the wording can't drift between the three (R10.2). The Scheduled Value cell next
 * to it already carries the combined figure; this is what makes the split visible without
 * opening the Line Items screen's "Add" popup.
 */
export function summaryRowLabel(name: string, performanceCents: number): string {
  if (performanceCents <= 0) return name;
  return `${name} (includes ${formatMoney(performanceCents)} performance)`;
}
