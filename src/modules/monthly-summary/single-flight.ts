import "server-only";

/**
 * P11: one run at a time per (org, source, month) — the in-process lock `writeSummaryAction`
 * takes, and the screen reads (`writing`, §6) to show "Writing your summary…" for every tab,
 * not only the one that started it.
 *
 * ponytail: in-process, single container — same ceiling as `rate-limit.ts`. Upgrade to a
 * shared lock (e.g. a Postgres advisory lock) if this ever runs on more than one container.
 */
const inFlight = new Set<string>();

export function summaryWriteKey(orgId: string, sourceId: string, month: string): string {
  return `${orgId}:${sourceId}:${month}`;
}

export function isSummaryWriting(orgId: string, sourceId: string, month: string): boolean {
  return inFlight.has(summaryWriteKey(orgId, sourceId, month));
}

export function beginSummaryWrite(key: string): void {
  inFlight.add(key);
}

export function endSummaryWrite(key: string): void {
  inFlight.delete(key);
}
