/**
 * Postgres error checks shared by every writer. Not `"use server"`: every export of such a file
 * is a public endpoint.
 */

/**
 * True for Postgres unique_violation (23505), raw or wrapped by Drizzle (which keeps the pg error
 * as `cause`). An app-level "that name already exists" check runs first everywhere; this turns
 * the race it cannot close (two saves of the same name at once, stopped by a unique index) into
 * the same friendly refusal instead of a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, "23505");
}

/**
 * True for foreign_key_violation (23503), either way round: a save pointing at a row that is gone,
 * or a delete of a row others still point at (a user with audit history, say).
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasCode(error, "23503");
}

/** True for check_violation (23514): a row broke one of the table's CHECK constraints. */
export function isCheckViolation(error: unknown): boolean {
  return hasCode(error, "23514");
}

/**
 * True for deadlock_detected (40P01): Postgres broke a lock cycle by rolling this transaction
 * back. Nothing was written, so the honest answer is "try again".
 */
export function isDeadlock(error: unknown): boolean {
  return hasCode(error, "40P01");
}

/**
 * True when a save was refused because the line item it points at was deleted meanwhile: a
 * foreign-key violation on one of the `…_line_items_id…_fk` constraints (every table's link to
 * `line_items` is named that way). Deleting a line item locks it first (R9.3), so an expense,
 * draft, recurring item or performance saved on it at that moment waits, then lands here. Only
 * that constraint is matched, so another missing link is never misreported as the line item.
 */
export function isMissingLineItem(error: unknown): boolean {
  return hasCode(error, "23503") && fields(error, "constraint").some((name) => /_line_items_id/.test(name));
}

/** What `unlessLineItemGone` returns in place of the save's own result. */
export const LINE_ITEM_GONE = Symbol("line item gone");

/**
 * Runs a save and turns "its line item was deleted meanwhile" into `LINE_ITEM_GONE`, for the
 * caller to answer with `UI.lineItemGone` instead of an unhandled error. Any other error is
 * rethrown untouched. Every path that saves a row pointing at a line item uses it.
 */
export async function unlessLineItemGone<T>(save: () => Promise<T>): Promise<T | typeof LINE_ITEM_GONE> {
  try {
    return await save();
  } catch (error) {
    if (isMissingLineItem(error)) return LINE_ITEM_GONE;
    throw error;
  }
}

function hasCode(error: unknown, expected: string): boolean {
  return fields(error, "code").includes(expected);
}

/** A pg error's field as found on the error itself and on the `cause` Drizzle wraps it in; both
 *  are read, so a wrapper carrying its own value never hides the driver's. */
function fields(error: unknown, name: "code" | "constraint"): string[] {
  const read = (value: unknown) =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>)[name] : undefined;
  return [read(error), read((error as { cause?: unknown })?.cause)].filter(
    (value): value is string => typeof value === "string",
  );
}
