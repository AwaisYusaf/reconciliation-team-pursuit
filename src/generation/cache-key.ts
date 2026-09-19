/**
 * Cache keys for generated outputs (R10.4).
 *
 * Pure: no database, no storage — so the hashing rules can be unit tested directly, and so
 * a generator can compute its key without dragging the persistence layer in.
 */
import { createHash } from "node:crypto";

/**
 * Deterministic JSON: object keys sorted, array order preserved.
 *
 * `JSON.stringify` follows insertion order, so two snapshots holding identical data could
 * hash differently purely because a query returned columns in another order — which would
 * silently regenerate every output on every download. Sorting makes the hash a function of
 * the data alone.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    // An absent key and a key set to undefined describe the same data.
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
  return `{${entries.join(",")}}`;
}

/**
 * The cache key for one output.
 *
 * `generatorVersion` is part of the hash on purpose: when a generator's layout changes the
 * old bytes are stale even though no data moved, and bumping the version is what makes the
 * next download rebuild rather than serve the previous format.
 */
export function inputsHash(input: {
  snapshot: unknown;
  generatorVersion: string;
  /** Distinguishes per-line-item outputs sharing one snapshot. */
  scope?: string | null;
}): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        version: input.generatorVersion,
        scope: input.scope ?? null,
        snapshot: input.snapshot,
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

/**
 * A hash of the records alone — the snapshot without any generator version (PHASE-12 P14).
 *
 * A shared file stores this so its row can say "Your records changed" only when records did. The
 * artifact's own cache key also moves when a generator version is bumped, which would put that
 * message on every shared row after a release although nothing in the organisation changed.
 */
export function recordsHash(snapshot: unknown): string {
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex").slice(0, 32);
}
