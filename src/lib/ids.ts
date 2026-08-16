/**
 * Identifier validation.
 *
 * Client-supplied ids reach queries against `uuid` columns. Postgres raises 22P02 for a
 * malformed value, which escapes an action's typed-failure contract and detonates the
 * client error boundary — the exact outcome the ActionResult design exists to avoid. So
 * every id from outside is shape-checked first and treated as simply "not found".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
