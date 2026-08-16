/**
 * Dates and months (domain-rules §2).
 *
 * Every date-only value in this system is a calendar date in the organisation's fixed
 * timezone, America/Detroit (R2.5). A UTC server must not flip Detroit's date at 7–8 pm,
 * so "today" is computed through Intl with an explicit timeZone and date-only strings
 * are parsed by their parts — never through `new Date("2026-03-02")`, which is UTC.
 */

/** The organisation's fixed timezone (R2.5). */
export const ORG_TIME_ZONE = "America/Detroit";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const DATE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: ORG_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** ISO date string `YYYY-MM-DD`. */
export type IsoDate = string;
/** Month key `YYYY-MM` (R2.1). */
export type MonthKey = string;

/** Today's calendar date in the organisation's timezone, as `YYYY-MM-DD` (R2.5). */
export function todayIso(now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return DATE_PARTS.format(now);
}

/** The current reporting month in the organisation's timezone, as `YYYY-MM` (R2.5). */
export function currentMonthKey(now: Date = new Date()): MonthKey {
  return todayIso(now).slice(0, 7);
}

/** True for a well-formed, real `YYYY-MM` key. */
export function isValidMonthKey(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 1900 && year <= 2999;
}

/** True for a well-formed, real `YYYY-MM-DD` date. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** The month a date belongs to by default: `2026-03-02` → `2026-03`. */
export function monthKeyOfDate(date: IsoDate): MonthKey {
  return date.slice(0, 7);
}

/** `2026-02` → `February 2026` (R2.1 display form). */
export function monthLabel(key: MonthKey): string {
  const { year, month } = splitMonthKey(key);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** `2026-02` → `Feb` — used for the "Add to Feb" recurring button. */
export function monthShortLabel(key: MonthKey): string {
  const { month } = splitMonthKey(key);
  return MONTH_NAMES[month - 1].slice(0, 3);
}

/** `February 2026` → `2026-02`. Returns null when the label is not recognised. */
export function monthKeyFromLabel(label: string): MonthKey | null {
  const match = /^([A-Za-z]+)\s+(\d{4})$/.exec(label.trim());
  if (!match) return null;
  const index = MONTH_NAMES.findIndex(
    (name) => name.toLowerCase() === match[1].toLowerCase(),
  );
  if (index === -1) return null;
  return `${match[2]}-${String(index + 1).padStart(2, "0")}`;
}

/** Shift a month key by whole months: `("2026-02", -1)` → `2026-01`. */
export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const { year, month } = splitMonthKey(key);
  const zeroBased = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = zeroBased - newYear * 12 + 1;
  return `${String(newYear).padStart(4, "0")}-${String(newMonth).padStart(2, "0")}`;
}

/** Chronological comparison; month keys sort correctly as plain strings (R2.1). */
export function compareMonthKeys(a: MonthKey, b: MonthKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Number of days in a month key's month. */
export function daysInMonthKey(key: MonthKey): number {
  const { year, month } = splitMonthKey(key);
  return daysInMonth(year, month);
}

/**
 * Invoice period string for documents: `2/1/2026 to 2/28/2026` (R2.4).
 */
export function invoicePeriod(key: MonthKey): string {
  const { year, month } = splitMonthKey(key);
  return `${month}/1/${year} to ${month}/${daysInMonth(year, month)}/${year}`;
}

/**
 * US display form of a date-only value: `2026-03-02` → `3/2/2026`.
 * Parses the parts directly, so no timezone conversion can shift the day.
 */
export function formatDateUS(date: IsoDate): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${month}/${day}/${year}`;
}

/** First and last calendar dates of a month, as ISO strings. */
export function monthBounds(key: MonthKey): { start: IsoDate; end: IsoDate } {
  const { year, month } = splitMonthKey(key);
  const mm = String(month).padStart(2, "0");
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, "0")}`,
  };
}

/**
 * The month selector's rolling window (m00): 12 months back through 3 months ahead of
 * the current month, unioned with every month that already holds data, newest first.
 * Months older than the window stay reachable through the "Earlier month…" picker.
 */
export function monthWindow(
  monthsWithData: readonly MonthKey[] = [],
  now: Date = new Date(),
): MonthKey[] {
  const current = currentMonthKey(now);
  const keys = new Set<MonthKey>();
  for (let delta = -12; delta <= 3; delta += 1) keys.add(shiftMonth(current, delta));
  for (const key of monthsWithData) if (isValidMonthKey(key)) keys.add(key);
  return [...keys].sort((a, b) => compareMonthKeys(b, a));
}

function splitMonthKey(key: MonthKey): { year: number; month: number } {
  if (!isValidMonthKey(key)) throw new Error(`Invalid month key: ${key}`);
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one; UTC keeps it timezone-free.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
