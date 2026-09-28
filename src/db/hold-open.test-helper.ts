/**
 * Forces the interleaving a race needs, every time, instead of hoping two parallel calls collide.
 *
 * `holdOpen(setup, action)` opens a transaction on its own pooled connection, runs `setup` in it
 * (an uncommitted insert, a lock), then starts `action` on another connection while that
 * transaction is still open, waits long enough for `action` to reach whatever it will block on,
 * and only then commits. The action therefore always sees the other change arrive mid-way.
 *
 * `blocked` says whether `action` was still running when the hold was released, which is how a
 * test proves a lock does or does not make it wait.
 */
import { db } from "@/src/db";
import type { Transaction } from "@/src/db/org-lock";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function holdOpen<T>(
  setup: (tx: Transaction) => Promise<unknown>,
  action: () => Promise<T>,
  holdMs = 400,
): Promise<{ result: T; blocked: boolean }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let ready!: () => void;
  const isReady = new Promise<void>((resolve) => (ready = resolve));

  const holder = db.transaction(async (tx) => {
    await setup(tx);
    ready();
    await released;
  });
  await isReady;

  let finished = false;
  const pending = action().finally(() => {
    finished = true;
  });
  await sleep(holdMs);
  const blocked = !finished;
  release();
  await holder;
  return { result: await pending, blocked };
}
