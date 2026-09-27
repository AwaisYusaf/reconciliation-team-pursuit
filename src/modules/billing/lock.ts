/**
 * Runs calls with the same key one after another, in the order they arrived (P12): the billing
 * actions per org (`org:{id}`), so a double-click can't double-act. Ported unchanged from the
 * reference build's `lib/lock.ts`. In-process: every billing action is a server action, and those
 * share one copy of this module. Syncs don't use it; they order themselves by
 * `org_billing.synced_at` under the org row lock (D-125).
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
