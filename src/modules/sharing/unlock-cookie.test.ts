/** The shared-link unlock cookie (PHASE-12 P6, U-2). */
import { describe, expect, it } from "vitest";

import { isUnlocked, UNLOCK_COOKIE, UNLOCK_TTL_MS, unlockCookie } from "./unlock-cookie";

const NOW = 1_800_000_000_000;
const share = { id: "0190a1b2-0000-7000-8000-000000000001", passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$aaaa$bbbb", token: "k7Qm2xPa9Xy1" };

function issued(now = NOW) {
  return unlockCookie(share, now).value;
}

describe("unlockCookie", () => {
  it("is scoped to the link's own path, HttpOnly and SameSite=Lax, for twelve hours", () => {
    const cookie = unlockCookie(share, NOW);
    expect(cookie.name).toBe(UNLOCK_COOKIE);
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/s/k7Qm2xPa9Xy1" });
    expect(cookie.options.expires.getTime()).toBe(NOW + UNLOCK_TTL_MS);
    expect(UNLOCK_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });
});

describe("isUnlocked", () => {
  it("accepts a value it issued, until it expires", () => {
    const value = issued();
    expect(isUnlocked(share, value, NOW)).toBe(true);
    expect(isUnlocked(share, value, NOW + UNLOCK_TTL_MS - 1)).toBe(true);
    expect(isUnlocked(share, value, NOW + UNLOCK_TTL_MS)).toBe(false);
  });

  it("stops working the moment the password changes — even to the same password", () => {
    const value = issued();
    // A re-hash of the same password carries a fresh salt, so the stored hash differs.
    expect(isUnlocked({ ...share, passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$cccc$dddd" }, value, NOW)).toBe(false);
  });

  it("belongs to one share only", () => {
    expect(isUnlocked({ ...share, id: "0190a1b2-0000-7000-8000-000000000002" }, issued(), NOW)).toBe(false);
  });

  it("refuses a tampered signature or expiry", () => {
    const [version, expiry, mac] = issued().split(".");
    const flipped = mac.slice(0, -1) + (mac.endsWith("A") ? "B" : "A");
    expect(isUnlocked(share, `${version}.${expiry}.${flipped}`, NOW)).toBe(false);
    expect(isUnlocked(share, `${version}.${Number(expiry) + 1}.${mac}`, NOW)).toBe(false);
  });

  it("refuses an expiry further ahead than any cookie was given", () => {
    const farFuture = issued(NOW + 10 * UNLOCK_TTL_MS);
    expect(isUnlocked(share, farFuture, NOW)).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["two parts", "v1.123"],
    ["wrong version", issued().replace(/^v1/, "v2")],
    ["non-numeric expiry", "v1.abc.def"],
    ["four parts", `${issued()}.extra`],
  ])("refuses a %s value", (_, value) => {
    expect(isUnlocked(share, value, NOW)).toBe(false);
  });
});

describe("the production cookie", () => {
  it("is __Secure- and Secure, which browsers require of each other", async () => {
    const { vi } = await import("vitest");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "x".repeat(48));
    vi.resetModules();
    try {
      const production = await import("./unlock-cookie");
      const cookie = production.unlockCookie(share, NOW);
      expect(production.UNLOCK_COOKIE).toBe("__Secure-share_unlock");
      expect(cookie.name).toBe("__Secure-share_unlock");
      expect(cookie.options.secure).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
