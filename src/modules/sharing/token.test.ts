/** Share-link tokens (PHASE-12 P3, U-1). */
import { describe, expect, it } from "vitest";

import { generateShareToken, isShareToken, SHARE_TOKEN_LENGTH } from "./token";

describe("generateShareToken", () => {
  it("is twelve characters of [0-9A-Za-z]", () => {
    for (let i = 0; i < 200; i += 1) {
      const token = generateShareToken();
      expect(token).toHaveLength(SHARE_TOKEN_LENGTH);
      expect(token).toMatch(/^[0-9A-Za-z]{12}$/);
    }
  });

  it("drops bytes at or above 248, so the alphabet stays uniform", () => {
    // 248..255 would all fold onto the first eight characters under a plain `% 62`.
    const skipped = Array.from({ length: 24 }, (_, i) => 248 + (i % 8));
    const used = [0, 1, 61, 62, 123, 247, 10, 11, 12, 13, 14, 15];
    let call = 0;
    const token = generateShareToken((size) => {
      call += 1;
      return Buffer.from(call === 1 ? skipped.slice(0, size) : [...used, ...used].slice(0, size));
    });
    expect(call).toBe(2);
    expect(token).toBe("01z0zzABCDEF");
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 1_000 }, () => generateShareToken()));
    expect(seen.size).toBe(1_000);
  });
});

describe("isShareToken", () => {
  it("accepts exactly twelve base62 characters", () => {
    expect(isShareToken("k7Qm2xPa9Xy1")).toBe(true);
  });

  it.each([
    ["eleven characters", "k7Qm2xPa9Xy"],
    ["thirteen characters", "k7Qm2xPa9Xy12"],
    ["a dash", "k7Qm2xPa9X-1"],
    ["an underscore", "k7Qm2xPa9X_1"],
    ["a traversal", "../k7Qm2xPa9"],
    ["non-ASCII", "k7Qm2xPa9Xyé"],
    ["empty", ""],
  ])("refuses %s", (_, value) => {
    expect(isShareToken(value)).toBe(false);
  });

  it("refuses anything that isn't a string", () => {
    expect(isShareToken(undefined)).toBe(false);
    expect(isShareToken(123456789012)).toBe(false);
  });
});
