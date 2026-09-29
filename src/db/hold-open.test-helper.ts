/**
 * Forces the interleaving a race needs, every time, instead of hoping two parallel calls collide.
 *
 * `holdOpen(setup, action)` opens a transaction on its own pooled connection, runs `setup` in it
 * (an uncommitted insert, a lock), then starts `action` on another connection while that
 * transaction is still open. It asks Postgres, not the clock, whether `action` is now waiting on
 * that transaction (`pg_blocking_pids`), and commits only once it is, or once `action` has
 * finished without ever waiting. So the action always meets the other change mid-way, even on a
 * machine too slow for a fixed sleep to be long enough.
 *
 * `blocked` says whether `action` waited on the held transaction, which is how a test proves a
 * lock does, or does not, make it wait.
 */
import { sql } from "drizzle-orm";

import { db } from "@/src/db";
import type { Transaction } from "@/src/db/org-lock";

const POLL_MS = 20;
/** Long enough for any action here to reach its lock; a hang past it fails the test, not the suite. */
const GIVE_UP_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function holdOpen<T>(
  setup: (tx: Transaction) => Promise<unknown>,
  action: () => Promise<T>,
): Promise<{ result: T; blocked: boolean }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let ready!: (pid: number) => void;
  const isReady = new Promise<number>((resolve) => (ready = resolve));

  const holder = db.transaction(async (tx) => {
    const [{ pid }] = (await tx.execute(sql`select pg_backend_pid() as pid`)).rows as Array<{ pid: number }>;
    await setup(tx);
    ready(pid);
    await released;
  });
  const holderPid = await isReady;

  let finished = false;
  // Settled at once, so an action that throws is not reported as an unhandled rejection while
  // the loop below is still polling; it is rethrown at the end instead.
  const pending = action().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  void pending.then(() => {
    finished = true;
  });

  let blocked = false;
  for (let waited = 0; !finished && !blocked && waited < GIVE_UP_MS; waited += POLL_MS) {
    const { rows } = await db.execute(
      sql`select 1 from pg_stat_activity where ${holderPid}::int = any(pg_blocking_pids(pid)) limit 1`,
    );
    blocked = rows.length > 0;
    if (!blocked) await sleep(POLL_MS);
  }

  release();
  await holder;
  const outcome = await pending;
  if (!outcome.ok) throw outcome.error;
  return { result: outcome.value, blocked };
}
