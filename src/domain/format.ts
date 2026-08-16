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
  return roundHalfAwayFromZero(ratio * 100);
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
