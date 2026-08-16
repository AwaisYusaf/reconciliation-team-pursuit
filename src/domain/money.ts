/**
 * Money — integer cents everywhere (domain-rules R1.1).
 *
 * Every amount in the system is an integer number of cents. Floating-point dollars
 * never enter the domain: they are parsed at the edge (here) and formatted at the
 * edge (format.ts). Nothing else in the codebase may do money arithmetic.
 */

/** Largest amount we accept, to keep parsing well inside the safe integer range. */
const MAX_CENTS = 1_000_000_000_000; // $10 billion

/**
 * Parse user input into integer cents.
 *
 * Accepts the shapes people actually type or paste: `1234.5`, `1,234.56`, `$1,234.56`,
 * `-145`, `(145.00)` (accounting negative), and leading/trailing whitespace.
 * Returns `null` for anything that is not a number, so callers can distinguish
 * "empty/invalid" from "zero" (R1.4 allows genuine negatives).
 */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return clampToCents(toCents(input));
  }

  let text = input.trim();
  if (text === "") return null;

  // Accounting negatives: (145.00) means -145.00
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  text = text.replace(/[$\s,]/g, "");

  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  if (!/^\d*\.?\d*$/.test(text) || text === "" || text === ".") return null;

  const value = Number(text);
  if (!Number.isFinite(value)) return null;

  const cents = toCents(value);
  return clampToCents(negative ? -cents : cents);
}

/**
 * Dollars → cents, half away from zero.
 *
 * `value * 100` drifts in binary floating point (1.005 * 100 is 100.49999999999999),
 * so the product is snapped back to a sane decimal scale before rounding. Both the
 * string and number entry points go through here, so they can never disagree.
 */
function toCents(value: number): number {
  const scaled = Number((value * 100).toFixed(4));
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/** Parse, treating empty/invalid input as zero. For optional money fields that default to $0.00. */
export function parseMoneyToCentsOrZero(input: string | number | null | undefined): number {
  return parseMoneyToCents(input) ?? 0;
}

/** Cents → dollars as a number. Only for writing numeric cells into spreadsheets. */
export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** Sum any number of cent amounts. Negatives (refunds) net out (R1.4). */
export function sumCents(...values: Array<number | null | undefined>): number {
  let total = 0;
  for (const value of values) total += value ?? 0;
  return total;
}

/** Sum a list by a projection — the common "total this month" shape. */
export function sumBy<T>(items: readonly T[], project: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += project(item);
  return total;
}

/**
 * Reimbursable amount = subtotal + fees (R1.3).
 * Sales tax is captured but excluded — the City does not reimburse it.
 */
export function reimbursableCents(amounts: {
  subtotalCents: number;
  feesCents: number;
}): number {
  return amounts.subtotalCents + amounts.feesCents;
}

function clampToCents(cents: number): number | null {
  if (!Number.isFinite(cents)) return null;
  if (Math.abs(cents) > MAX_CENTS) return null;
  return cents;
}
