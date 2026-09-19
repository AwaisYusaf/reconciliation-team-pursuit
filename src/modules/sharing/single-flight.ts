import "server-only";

/**
 * One share or update build at a time per file — (org, source, month, kind) — PHASE-12 P13.
 *
 * A double click, or two people sharing the same month together, must not assemble a 70 MB packet
 * twice. The database's active-row index still settles any race that slips past this (a second
 * container, a restart mid-build), so this only saves the work, never guards correctness.
 *
 * ponytail: in-process, single container — the same ceiling as `rate-limit.ts` and
 * `monthly-summary/single-flight.ts`. Move to a Postgres advisory lock if this ever runs on
 * more than one container.
 */
const inFlight = new Set<string>();

export function shareBuildKey(orgId: string, sourceId: string, month: string, kind: string): string {
  return `${orgId}:${sourceId}:${month}:${kind}`;
}

/** Claims the key; false when a build for the same file is already running. */
export function beginShareBuild(key: string): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function endShareBuild(key: string): void {
  inFlight.delete(key);
}
