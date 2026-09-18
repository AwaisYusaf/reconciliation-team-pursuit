import "server-only";

/**
 * How many amount reads one organisation may have running at once (PR #18 review).
 *
 * The rate limit bounds reads per hour, not reads at the same instant, and a single read is
 * memory-hungry while it lasts: the uploaded file is buffered, inspected (a HEIC is decoded and
 * re-encoded), and base64-encoded for the request, so a 25 MB file is held several times over.
 * The Add Expense form only sends two at a time, but nothing stopped a script from posting
 * hundreds together and exhausting the container.
 *
 * ponytail: in-process counter, single container — same ceiling as `rate-limit.ts` and
 * `monthly-summary/single-flight.ts`. Upgrade alongside them if this ever runs on more than one.
 */
const MAX_IN_FLIGHT_PER_ORG = 4;

const inFlight = new Map<string, number>();

/** Takes a slot if one is free. Returns false when the organisation is already at the limit. */
export function beginRead(orgId: string): boolean {
  const current = inFlight.get(orgId) ?? 0;
  if (current >= MAX_IN_FLIGHT_PER_ORG) return false;
  inFlight.set(orgId, current + 1);
  return true;
}

/** Always called in a `finally`: a slot that is never returned locks the organisation out. */
export function endRead(orgId: string): void {
  const current = inFlight.get(orgId) ?? 0;
  if (current <= 1) inFlight.delete(orgId);
  else inFlight.set(orgId, current - 1);
}

/** Test seam only. */
export function readsInFlight(orgId: string): number {
  return inFlight.get(orgId) ?? 0;
}

export { MAX_IN_FLIGHT_PER_ORG };
