/**
 * `webStreamFrom` — how a stored object reaches a shared link's visitor (PHASE-12 review).
 *
 * The case that matters: a visitor closes the tab partway through a 70 MB packet. Next pipes the
 * body with an abort signal and cancels it; `Readable.toWeb` then threw "Controller is already
 * closed" as an uncaught exception for every abandoned download. The pipe-and-abort below is that
 * path without the server.
 */
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { webStreamFrom } from "./web-stream";

const CHUNK = 64 * 1024;

/** A source of `count` chunks that records how many it has been asked for. */
function countingSource(count: number) {
  let produced = 0;
  const source = new Readable({
    read() {
      if (produced === count) return void this.push(null);
      produced += 1;
      this.push(Buffer.alloc(CHUNK, produced % 256));
    },
  });
  return { source, produced: () => produced };
}

const uncaught: unknown[] = [];
const onUncaught = (error: unknown) => uncaught.push(error);

afterEach(() => {
  process.off("uncaughtException", onUncaught);
  uncaught.length = 0;
});

describe("webStreamFrom", () => {
  it("delivers every byte, in order", async () => {
    const parts = [Buffer.from("first "), Buffer.from("second "), Buffer.from("third")];
    const text = await new Response(webStreamFrom(Readable.from(parts))).text();
    expect(text).toBe("first second third");
  });

  it("a download abandoned partway throws nothing and releases the source", async () => {
    process.on("uncaughtException", onUncaught);
    for (let round = 0; round < 5; round += 1) {
      const { source } = countingSource(2_000);
      const controller = new AbortController();
      // A slow visitor: each write takes a moment, so the pipe is mid-file when they leave.
      const sink = new WritableStream({ write: () => new Promise((resolve) => setTimeout(resolve, 2)) });
      const piping = webStreamFrom(source).pipeTo(sink, { signal: controller.signal });
      setTimeout(() => controller.abort(), 30);
      await expect(piping).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(source.destroyed).toBe(true);
    }
    expect(uncaught).toEqual([]);
  });

  it("reads no further ahead than the visitor takes", async () => {
    const { source, produced } = countingSource(1_000);
    const reader = webStreamFrom(source).getReader();
    await reader.read();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // One chunk taken; Node's own buffer (16 KB here, 64 KB for files) plus one queued chunk may
    // be read ahead, never the rest of a 64 MB source.
    expect(produced()).toBeLessThan(10);
    await reader.cancel();
  });

  it("a storage failure mid-file errors the stream instead of ending it short", async () => {
    const source = new Readable({
      read() {
        this.destroy(new Error("connection reset"));
      },
    });
    await expect(new Response(webStreamFrom(source)).arrayBuffer()).rejects.toThrow("connection reset");
  });
});
