import { describe, expect, it } from "vitest";

import {
  generateSessionToken,
  hashSessionToken,
  isExpired,
  needsRenewal,
  SESSION_RENEW_THRESHOLD_MS,
  SESSION_TTL_MS,
  sessionCookieOptions,
  sessionExpiry,
  tokenHashesEqual,
} from "./tokens";

const DAY = 24 * 60 * 60 * 1000;

describe("session tokens", () => {
  it("generates unguessable, unique tokens", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateSessionToken()));
    expect(tokens.size).toBe(500);
    // 32 random bytes, base64url encoded, no padding.
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("stores only the hash, never the token itself", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    // Deterministic, so a cookie can be looked up.
    expect(hashSessionToken(token)).toBe(hash);
  });

  it("produces different hashes for different tokens", () => {
    expect(hashSessionToken("a")).not.toBe(hashSessionToken("b"));
  });

  it("compares hashes without leaking length or content by timing", () => {
    const hash = hashSessionToken("token");
    expect(tokenHashesEqual(hash, hash)).toBe(true);
    expect(tokenHashesEqual(hash, hashSessionToken("other"))).toBe(false);
    expect(tokenHashesEqual(hash, "short")).toBe(false);
  });
});

describe("expiry and the sliding window", () => {
  const now = new Date("2026-08-16T12:00:00Z");

  it("issues a 30-day expiry", () => {
    expect(sessionExpiry(now).getTime() - now.getTime()).toBe(SESSION_TTL_MS);
    expect(SESSION_TTL_MS).toBe(30 * DAY);
  });

  it("treats a session as expired at and after its expiry instant", () => {
    expect(isExpired(new Date(now.getTime() + 1000), now)).toBe(false);
    expect(isExpired(now, now)).toBe(true);
    expect(isExpired(new Date(now.getTime() - 1000), now)).toBe(true);
  });

  it("renews only inside the final 15 days", () => {
    expect(SESSION_RENEW_THRESHOLD_MS).toBe(15 * DAY);
    const inDays = (days: number) => new Date(now.getTime() + days * DAY);

    expect(needsRenewal(inDays(30), now)).toBe(false);
    expect(needsRenewal(inDays(16), now)).toBe(false);
    expect(needsRenewal(inDays(15), now)).toBe(false); // exactly at the threshold
    expect(needsRenewal(inDays(14), now)).toBe(true);
    expect(needsRenewal(inDays(1), now)).toBe(true);
  });

  it("never renews an already-expired session", () => {
    expect(needsRenewal(new Date(now.getTime() - DAY), now)).toBe(false);
  });
});

describe("cookie options", () => {
  it("is HttpOnly, SameSite=Lax, root-scoped", () => {
    const options = sessionCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("expires with the session", () => {
    const now = new Date("2026-08-16T12:00:00Z");
    expect(sessionCookieOptions(now).expires.getTime()).toBe(sessionExpiry(now).getTime());
  });

  it("requires HTTPS in production", () => {
    const original = process.env.NODE_ENV;
    try {
      // NODE_ENV is readonly in the Next types but writable at runtime.
      (process.env as Record<string, string>).NODE_ENV = "production";
      expect(sessionCookieOptions().secure).toBe(true);
      (process.env as Record<string, string>).NODE_ENV = "development";
      expect(sessionCookieOptions().secure).toBe(false);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = original ?? "test";
    }
  });
});
