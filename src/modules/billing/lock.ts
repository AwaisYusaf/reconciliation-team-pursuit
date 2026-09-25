/**
 * Runs calls with the same key one after another, in the order they arrived (P12): billing
 * actions per org (`org:{id}`), syncs per customer (`sync:{customerId}`). Ported unchanged from
 * the reference build's `lib/lock.ts`.
 *
 * ponytail: in-process, correct for the one `next start` process this app runs (§2.3). With
 * several app processes, replace with `pg_advisory_xact_lock(hashtext(key))`.
 */
const tails = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  tails.set(key, run);
  try {
    return await run;
  } finally {
    if (tails.get(key) === run) tails.delete(key);
  }
}
