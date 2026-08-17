import { describe, expect, it } from "vitest";

import {
  generateSessionToken,
  hashSessionToken,
  isExpired,
  needsRenewal,
  SESSION_RENEW_THRESHOLD_MS,
  SESSION_MAX_AGE_MS,
  SESSION_TTL_MS,
  exceedsMaxAge,
  sessionCookieOptions,
  sessionExpiry,
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

  /**
   * Rotating `AUTH_SECRET` is the operator's only way to end every session at once — with
   * one shared account, no self-serve reset (D-24) and no session-list UI, that lever has to
   * genuinely work rather than merely be documented.
   */
  it("changes every stored hash when the secret is rotated", () => {
    const original = process.env.AUTH_SECRET;
    try {
      process.env.AUTH_SECRET = "secret-one";
      const before = hashSessionToken("a-token");

      process.env.AUTH_SECRET = "secret-two";
      const after = hashSessionToken("a-token");

      // The same cookie no longer resolves to the same row, so every session is dead.
      expect(after).not.toBe(before);
      expect(after).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      if (original === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = original;
    }
  });
});

describe("absolute session age", () => {
  const created = new Date("2026-01-01T00:00:00Z");

  it("allows a session inside the cap however often it renews", () => {
    expect(exceedsMaxAge(created, new Date("2026-03-01T00:00:00Z"))).toBe(false);
  });

  it("ends one that has outlived the cap", () => {
    // The sliding window alone would keep this alive forever if touched monthly.
    expect(exceedsMaxAge(created, new Date("2026-05-01T00:00:00Z"))).toBe(true);
  });

  it("treats the boundary itself as exceeded", () => {
    expect(exceedsMaxAge(created, new Date(created.getTime() + SESSION_MAX_AGE_MS))).toBe(true);
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
