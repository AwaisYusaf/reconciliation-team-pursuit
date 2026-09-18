/**
 * The HEIC decoder's worker lifecycle (PR #18 round 3, #3): at most two decodes at once, a stuck
 * decode times out, and every worker is terminated. `node:worker_threads` is replaced by a fake
 * worker the test answers by hand; `heic.test.ts` covers the real decode.
 */
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

const workers: FakeWorker[] = [];

class FakeWorker extends EventEmitter {
  terminate = vi.fn(async () => 0);
  constructor() {
    super();
    workers.push(this);
  }
  /** Answer the way the real worker does. */
  reply() {
    this.emit("message", { width: 1, height: 1, data: new Uint8Array(4) });
  }
}

vi.mock("node:worker_threads", () => ({ Worker: FakeWorker }));

const { decodeHeic } = await import("./heic");

const flush = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
  workers.length = 0;
});

describe("decodeHeic worker lifecycle", () => {
  it("runs at most two decodes at once; the rest start as slots free up", async () => {
    const decodes = [1, 2, 3, 4, 5].map(() => decodeHeic(Buffer.from("x")));
    await flush();
    expect(workers).toHaveLength(2);

    workers[0].reply();
    await flush();
    expect(workers).toHaveLength(3);

    for (let i = 1; i < 5; i += 1) {
      await flush();
      workers[i].reply();
    }
    await expect(Promise.all(decodes)).resolves.toHaveLength(5);
  });

  it("terminates the worker after a successful decode", async () => {
    const decode = decodeHeic(Buffer.from("x"));
    await flush();
    workers[0].reply();
    await decode;
    expect(workers[0].terminate).toHaveBeenCalled();
  });

  it("a decode that never answers times out after 30 s, and its worker is terminated", async () => {
    vi.useFakeTimers();
    const decode = decodeHeic(Buffer.from("x"));
    const outcome = expect(decode).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(0);
    expect(workers).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(workers[0].terminate).toHaveBeenCalled();
  });
});
