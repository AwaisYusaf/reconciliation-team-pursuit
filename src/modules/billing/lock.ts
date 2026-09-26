/**
 * Runs calls with the same key one after another, in the order they arrived (P12): billing
 * actions per org (`org:{id}`), syncs per customer (`sync:{customerId}`). Ported unchanged from
 * the reference build's `lib/lock.ts`.
 *
 * In-process only. The billing actions (`org:`) all run as server actions, which share one copy
 * of this module, so a double-click is serialised. Syncs (`sync:`) also run from the webhook route
 * and the nightly reconcile, which have their own copies (the bundler gives route handlers a
 * separate one), so for syncs this only saves duplicate work: they order themselves by
 * `org_billing.synced_at` (D-125) under the org row lock.
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
