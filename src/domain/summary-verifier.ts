/**
 * The figure verifier (Phase 11, D-107, P4).
 *
 * Extracts every dollar amount and every percentage the model actually wrote, and reports which
 * ones were not in the set the app supplied (`MonthFacts.allowedAmounts`/`allowedPercents`).
 * Pure and cheap enough to run on every draft, including the one retry (P4).
 *
 * ponytail: this only catches figures written as digits with a `$` or `%` — an amount spelled
 * out in words, or typed without the `$`, slips through. P5 (the structure check) and human
 * review (Appendix A §5) are the real backstop for that; upgrade to a stricter grammar if a
 * real run is ever caught writing a bare number.
 */

// Parentheses first (the accounting-negative form wraps a whole amount), then a sign either
// side of the `$`, then the plain form. U+2212 (minus sign) is matched alongside ASCII `-`
// because a model can write either; `formatMoney` only ever produces ASCII, so anything using
// U+2212 can never be in the allowed set and is correctly rejected.
const AMOUNT_TOKEN =
  /\([-−]?\$[-−]?\d[\d,]*(?:\.\d+)?\)|[-−]\$[-−]?\d[\d,]*(?:\.\d+)?|\$[-−]?\d[\d,]*(?:\.\d+)?/g;

// Digit runs are bounded, not `+`: `\d+` followed by a required `%` backtracks over the whole
// tail at every start position, so a model reply padded with 100,000 digits (reachable through an
// injected expense description) froze this single-threaded server for ~7 s, twice per run. No real
// percentage has 13 digits before the point.
const PERCENT_TOKEN = /[-−]?\d{1,12}(?:\.\d{1,4})?\s?%/g;

/** Strip a trailing comma/period the amount regex's greedy digit-or-comma class can pick up
 *  from surrounding prose (e.g. "$100," at the end of a clause) — never part of the number. */
function cleanupAmount(raw: string): string {
  const hasParens = raw.startsWith("(") && raw.endsWith(")");
  const inner = hasParens ? raw.slice(1, -1) : raw;
  const cleaned = inner.replace(/[.,]+$/, "");
  return hasParens ? `(${cleaned})` : cleaned;
}

/**
 * Whether the app supplied this amount.
 *
 * Parentheses are ambiguous in prose: accountants write `($1,200.00)` for minus $1,200.00, but a
 * writer also writes "Salary ($45,641.12)" as a plain aside — and that is what the model does,
 * because the prompt asks it to name each line item with its amount. Treating every parenthesised
 * amount as a negative rejected the draft and burned a retry on two of three real months
 * (evaluation, 2026-09-18). So a parenthesised amount counts as supplied if the app supplied
 * either the amount itself or its negative; a bare `-$1,200.00` is still checked strictly.
 */
function isSupplied(token: string, allowedAmounts: ReadonlySet<string>): boolean {
  if (allowedAmounts.has(token)) return true;
  if (!token.startsWith("(") || !token.endsWith(")")) return false;
  const inner = token.slice(1, -1);
  return allowedAmounts.has(inner) || allowedAmounts.has(`-${inner}`);
}

/** A space before `%` doesn't change what number was written. */
function normalizePercent(raw: string): string {
  return raw.replace(/\s+%$/, "%");
}

export type UnsuppliedFigures = { amounts: string[]; percents: string[] };

/**
 * Every `$` amount and `n%` figure in `markdown` that is not exactly one of the strings the app
 * supplied. Unique, in order of first appearance.
 */
export function unsuppliedFigures(
  markdown: string,
  allowed: { allowedAmounts: readonly string[]; allowedPercents: readonly string[] },
): UnsuppliedFigures {
  const allowedAmounts = new Set(allowed.allowedAmounts);
  const allowedPercents = new Set(allowed.allowedPercents);

  const amounts: string[] = [];
  const seenAmounts = new Set<string>();
  for (const match of markdown.matchAll(AMOUNT_TOKEN)) {
    const token = cleanupAmount(match[0]);
    if (isSupplied(token, allowedAmounts) || seenAmounts.has(token)) continue;
    seenAmounts.add(token);
    amounts.push(token);
  }

  const percents: string[] = [];
  const seenPercents = new Set<string>();
  for (const match of markdown.matchAll(PERCENT_TOKEN)) {
    const token = normalizePercent(match[0]);
    if (allowedPercents.has(token) || seenPercents.has(token)) continue;
    seenPercents.add(token);
    percents.push(token);
  }

  return { amounts, percents };
}
