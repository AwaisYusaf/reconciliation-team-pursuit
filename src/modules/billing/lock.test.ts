// U-6/P12 sibling: `withLock` itself (Phase 15 §4.1). Pure, no I/O.
import { describe, expect, it } from "vitest";

import { withLock } from "./lock";

describe("withLock", () => {
  it("runs calls with the same key one after another, in arrival order, even when the first is slower", async () => {
    const order: string[] = [];
    const first = withLock("k", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("first");
    });
    const second = withLock("k", async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("a rejection doesn't jam the queue for calls behind it", async () => {
    const order: string[] = [];
    const failing = withLock("k2", async () => {
      order.push("failing");
      throw new Error("boom");
    }).catch(() => {
      order.push("caught");
    });
    const after = withLock("k2", async () => {
      order.push("after");
    });
    await Promise.all([failing, after]);
    expect(order).toEqual(["failing", "caught", "after"]);
  });

  it("different keys don't wait on each other", async () => {
    const order: string[] = [];
    const slow = withLock("a", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("slow-a");
    });
    const fast = withLock("b", async () => {
      order.push("fast-b");
    });
    await Promise.all([slow, fast]);
    // b finishes first even though a started first, because they don't share a key.
    expect(order).toEqual(["fast-b", "slow-a"]);
  });

  it("returns the function's resolved value and propagates its rejection", async () => {
    await expect(withLock("v", async () => 42)).resolves.toBe(42);
    await expect(
      withLock("v", async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
  });
});
