/**
 * HEIC decoding off the main thread (PR #18 round 2, #4). The fixture is a real 412x484 HEVC HEIC.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createLimiter, decodeHeic, HEIC_MAX_PIXELS } from "./heic";

const heic = readFileSync(new URL("./__fixtures__/receipt.heic", import.meta.url));

describe("decodeHeic", () => {
  it("decodes a real HEIC to RGBA of its own size", async () => {
    const { width, height, data } = await decodeHeic(heic);
    expect([width, height]).toEqual([412, 484]);
    expect(data.byteLength).toBe(412 * 484 * 4);
  });

  it("refuses an image over the limit, measured on the image actually decoded", async () => {
    // 412 x 484 = 199,408 pixels: one under passes, the exact size passes, one over fails.
    await expect(decodeHeic(heic, 199_408)).resolves.toMatchObject({ width: 412 });
    await expect(decodeHeic(heic, 199_407)).rejects.toThrow(/pixel limit/);
  });

  it("caps real photos at 25 MP", () => {
    expect(HEIC_MAX_PIXELS).toBe(25_000_000);
  });

  it("rejects a damaged file instead of throwing out of the worker", async () => {
    await expect(decodeHeic(heic.subarray(0, 2000))).rejects.toThrow();
  });
});

describe("createLimiter", () => {
  it("never runs more than its limit at once, and runs everything", async () => {
    const limiter = createLimiter(2);
    let peak = 0;
    const done: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        limiter.run(async () => {
          peak = Math.max(peak, limiter.running);
          await new Promise((resolve) => setTimeout(resolve, 10));
          done.push(n);
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("frees its slot when a task fails", async () => {
    const limiter = createLimiter(1);
    await expect(limiter.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limiter.run(async () => "next")).resolves.toBe("next");
  });
});
