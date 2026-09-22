"use client";

/**
 * Keeping a read invoice across a reload.
 *
 * Reading an invoice costs a model call and then several minutes of someone's attention:
 * twelve charges, each with a line item to choose and a narrative to write. All of it lived in
 * React state, so a hard refresh — or a misclick onto Back, or a laptop sleeping — threw the
 * whole thing away and the invoice had to be read again, at the same cost.
 *
 * **IndexedDB, not `sessionStorage`**, because the invoice itself is a `File` and so is every
 * receipt queued on a card. `sessionStorage` holds strings; IndexedDB stores a `File` directly
 * through the structured clone algorithm, which is the only way the actual bytes survive a
 * reload. Without them "restored" would mean a screen full of charges that cannot be submitted,
 * since Done posts the file.
 *
 * **Client-side, not a server-side stash**, which keeps PHASE-14.md §2.2's rule intact: nothing
 * is written to the database or to storage until Done, so an abandoned check screen still
 * leaves no import row and no orphan object. What is held here never leaves the browser, and
 * it is cleared the moment the charges are submitted or deliberately discarded.
 *
 * Everything here fails soft. Private windows, cleared site data and disabled storage all make
 * IndexedDB throw or return nothing, and a screen that works today must not start crashing
 * because a convenience is unavailable — so every call resolves rather than rejects, and the
 * screen behaves exactly as it did before when the store is empty.
 */
const DB_NAME = "stayfunded-invoice-check";
const STORE = "reads";
const KEY = "current";
const DB_VERSION = 1;

/** What a restore has to agree with before it is offered, so a read from a month or a grant
 *  the person has since left cannot reappear under the wrong heading. */
export type CheckScope = { month: string; fundingSourceId: string };

type Stored<T> = CheckScope & { savedAt: number; check: T };

/** A day. Long enough to survive a laptop closing overnight, short enough that a forgotten
 *  read does not reappear a week later as a surprise. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      // A blocked upgrade would otherwise hang this promise, and with it the screen's effect.
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const database = await open();
  if (!database) return null;
  return new Promise<T | null>((resolve) => {
    try {
      const request = run(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      // Closed on the next tick either way: holding it open blocks a later version upgrade.
      setTimeout(() => database.close(), 0);
    }
  });
}

/** Keep the current read. Called on every change, so it overwrites rather than appends. */
export async function saveCheck<T>(scope: CheckScope, check: T): Promise<void> {
  const record: Stored<T> = { ...scope, savedAt: Date.now(), check };
  await withStore("readwrite", (store) => store.put(record, KEY));
}

/**
 * The kept read, when there is one that still belongs here.
 *
 * Returns null for a different month or funding source, for anything older than a day, and for
 * every storage failure — all of which the caller treats the same way: start clean.
 */
export async function loadCheck<T>(scope: CheckScope): Promise<T | null> {
  const record = await withStore<Stored<T>>("readonly", (store) => store.get(KEY));
  if (!record || !record.check) return null;
  if (record.month !== scope.month || record.fundingSourceId !== scope.fundingSourceId) return null;
  if (Date.now() - record.savedAt > MAX_AGE_MS) return null;
  return record.check;
}

/** Forget it: the charges were submitted, or the person chose to drop them. */
export async function clearCheck(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(KEY));
}
