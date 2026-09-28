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

/** True for foreign_key_violation (23503): the row a new link points at was deleted meanwhile. */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasCode(error, "23503");
}

/**
 * True for deadlock_detected (40P01): Postgres broke a lock cycle by rolling this transaction
 * back. Nothing was written, so the honest answer is "try again".
 */
export function isDeadlock(error: unknown): boolean {
  return hasCode(error, "40P01");
}

function hasCode(error: unknown, expected: string): boolean {
  const code = (value: unknown) =>
    typeof value === "object" && value !== null ? (value as { code?: unknown }).code : undefined;
  return code(error) === expected || code((error as { cause?: unknown })?.cause) === expected;
}
