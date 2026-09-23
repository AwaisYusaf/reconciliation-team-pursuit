/**
 * The rules that decide whether a kept invoice read is offered back.
 *
 * Restoring the wrong one is worse than restoring nothing: a read left in January reappearing
 * under March would put a whole bill's charges in the wrong month, and a week-old read
 * reappearing at all is a surprise nobody asked for. Those decisions are pure, so they are
 * tested directly against a fake IndexedDB rather than through the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearCheck, loadCheck, saveCheck } from "./check-draft-store";

/**
 * Enough of IndexedDB for one keyed record.
 *
 * `fake-indexeddb` is not a dependency here and this needs four operations, so a small stub is
 * the smaller thing to maintain — and it lets a test make the store fail on demand, which is
 * the case that matters most: the screen has to keep working when storage does not.
 */
function installFakeIndexedDB(options: { failing?: boolean } = {}) {
  const records = new Map<string, unknown>();

  function request<T>(run: () => T) {
    const req: Record<string, unknown> = { result: undefined, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      if (options.failing) {
        (req.onerror as (() => void) | null)?.();
        return;
      }
      req.result = run();
      (req.onsuccess as (() => void) | null)?.();
    });
    return req;
  }

  const store = {
    put: (value: unknown, key: string) => request(() => records.set(key, value)),
    get: (key: string) => request(() => records.get(key)),
    delete: (key: string) => request(() => records.delete(key)),
  };

  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => store,
    transaction: () => ({ objectStore: () => store }),
    close: () => {},
  };

  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      const req: Record<string, unknown> = {
        result: database,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        if (options.failing) {
          (req.onerror as (() => void) | null)?.();
          return;
        }
        (req.onsuccess as (() => void) | null)?.();
      });
      return req;
    },
  };

  return records;
}

const HERE = { month: "2026-03", fundingSourceId: "11111111-1111-1111-1111-111111111111" };

describe("the kept invoice read", () => {
  beforeEach(() => {
    installFakeIndexedDB();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("comes back for the same month and funding source", async () => {
    await saveCheck(HERE, { vendor: "Detroit Sound Supply", rows: 12 });
    expect(await loadCheck(HERE)).toEqual({ vendor: "Detroit Sound Supply", rows: 12 });
  });

  it("is not offered under a different month", async () => {
    await saveCheck(HERE, { vendor: "Detroit Sound Supply" });
    // The charges belong to January's bill; showing them under March would file a whole
    // invoice into the wrong month.
    expect(await loadCheck({ ...HERE, month: "2026-01" })).toBeNull();
  });

  it("is not offered under a different funding source", async () => {
    await saveCheck(HERE, { vendor: "Detroit Sound Supply" });
    expect(
      await loadCheck({ ...HERE, fundingSourceId: "22222222-2222-2222-2222-222222222222" }),
    ).toBeNull();
  });

  it("is forgotten after a day, so an abandoned read does not resurface later", async () => {
    await saveCheck(HERE, { vendor: "Detroit Sound Supply" });

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    expect(await loadCheck(HERE)).toBeNull();
  });

  it("is gone once cleared, which is what Done and Back do", async () => {
    await saveCheck(HERE, { vendor: "Detroit Sound Supply" });
    await clearCheck();
    expect(await loadCheck(HERE)).toBeNull();
  });

  it("answers null rather than throwing when storage is unavailable", async () => {
    // Private windows, blocked site data, a failed upgrade. The screen must behave exactly as
    // it did before this store existed, not break because a convenience is missing.
    installFakeIndexedDB({ failing: true });
    await expect(saveCheck(HERE, { vendor: "Anything" })).resolves.toBeUndefined();
    await expect(loadCheck(HERE)).resolves.toBeNull();
    await expect(clearCheck()).resolves.toBeUndefined();
  });

  it("answers null when there is nothing kept at all", async () => {
    expect(await loadCheck(HERE)).toBeNull();
  });
});
