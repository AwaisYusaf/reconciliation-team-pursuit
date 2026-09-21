import { beforeEach, describe, expect, it } from "vitest";

import { clearAll, consume, LIMITS, reset, size, sweep } from "./rate-limit";

beforeEach(() => clearAll());

describe("login rate limits", () => {
  it("allows the configured number of attempts then blocks", () => {
    const key = "misty@example.org|203.0.113.5";
    for (let attempt = 1; attempt <= LIMITS.loginPerAccount.limit; attempt += 1) {
      const result = consume("loginPerAccount", key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMITS.loginPerAccount.limit - attempt);
    }

    const blocked = consume("loginPerAccount", key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps separate budgets per subject", () => {
    const now = Date.now();
    for (let i = 0; i < LIMITS.loginPerAccount.limit; i += 1) {
      consume("loginPerAccount", "attacker", now);
    }
    expect(consume("loginPerAccount", "attacker", now).allowed).toBe(false);
    expect(consume("loginPerAccount", "innocent", now).allowed).toBe(true);
  });

  it("keeps separate budgets per limit name", () => {
    const now = Date.now();
    for (let i = 0; i < LIMITS.loginPerAccount.limit; i += 1) {
      consume("loginPerAccount", "same-key", now);
    }
    expect(consume("loginPerAccount", "same-key", now).allowed).toBe(false);
    expect(consume("loginPerIp", "same-key", now).allowed).toBe(true);
  });

  it("bounds argon2 CPU per IP even when the attacker rotates emails", () => {
    const now = Date.now();
    const ip = "203.0.113.9";
    for (let i = 0; i < LIMITS.loginPerIp.limit; i += 1) {
      expect(consume("loginPerIp", ip, now).allowed).toBe(true);
    }
    expect(consume("loginPerIp", ip, now).allowed).toBe(false);
  });

  it("reopens the window once it elapses", () => {
    const start = 1_000_000;
    const key = "misty@example.org";
    for (let i = 0; i < LIMITS.loginPerAccount.limit; i += 1) consume("loginPerAccount", key, start);
    expect(consume("loginPerAccount", key, start).allowed).toBe(false);

    const afterWindow = start + LIMITS.loginPerAccount.windowMs + 1;
    expect(consume("loginPerAccount", key, afterWindow).allowed).toBe(true);
  });

  it("reports a sensible retry-after", () => {
    const start = 1_000_000;
    for (let i = 0; i < LIMITS.loginPerAccount.limit; i += 1) consume("loginPerAccount", "k", start);

    const halfway = start + LIMITS.loginPerAccount.windowMs / 2;
    const blocked = consume("loginPerAccount", "k", halfway);
    expect(blocked.retryAfterSeconds).toBeCloseTo(LIMITS.loginPerAccount.windowMs / 2000, 0);
  });

  it("clears a subject's usage after a successful sign-in", () => {
    const now = Date.now();
    for (let i = 0; i < LIMITS.loginPerAccount.limit; i += 1) consume("loginPerAccount", "k", now);
    expect(consume("loginPerAccount", "k", now).allowed).toBe(false);

    reset("loginPerAccount", "k");
    expect(consume("loginPerAccount", "k", now).allowed).toBe(true);
  });
});

/**
 * `readInvoice` (Phase 14) must stay strictly tighter than `readAmounts` — a single invoice read
 * bills far more (up to 10 pages, 4000 output tokens) than a single amount read, and the two
 * budgets drifting together would silently remove the intended headroom.
 */
describe("readInvoice budget", () => {
  it("is tighter than readAmounts", () => {
    expect(LIMITS.readInvoice.limit).toBeLessThan(LIMITS.readAmounts.limit);
  });

  it("allows 20 reads then refuses the 21st within the hour", () => {
    const org = "org-invoice-1";
    const now = 1_000_000;
    for (let attempt = 1; attempt <= LIMITS.readInvoice.limit; attempt += 1) {
      const result = consume("readInvoice", org, now);
      expect(result.allowed).toBe(true);
    }

    const blocked = consume("readInvoice", org, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("budgets each org separately", () => {
    const now = 2_000_000;
    for (let attempt = 0; attempt < LIMITS.readInvoice.limit; attempt += 1) {
      consume("readInvoice", "org-invoice-noisy", now);
    }
    expect(consume("readInvoice", "org-invoice-noisy", now).allowed).toBe(false);
    expect(consume("readInvoice", "org-invoice-quiet", now).allowed).toBe(true);
  });

  it("reopens the window once it elapses", () => {
    const start = 3_000_000;
    const org = "org-invoice-2";
    for (let attempt = 0; attempt < LIMITS.readInvoice.limit; attempt += 1) consume("readInvoice", org, start);
    expect(consume("readInvoice", org, start).allowed).toBe(false);

    const afterWindow = start + LIMITS.readInvoice.windowMs + 1;
    expect(consume("readInvoice", org, afterWindow).allowed).toBe(true);
  });
});

describe("housekeeping", () => {
  it("drops expired buckets so the map cannot grow without bound", () => {
    const start = 1_000_000;
    consume("loginPerIp", "a", start);
    consume("loginPerIp", "b", start);

    sweep(start + LIMITS.loginPerIp.windowMs + 1);

    // A swept subject starts a fresh window, so it has its full budget again.
    const result = consume("loginPerIp", "a", start + LIMITS.loginPerIp.windowMs + 2);
    expect(result.remaining).toBe(LIMITS.loginPerIp.limit - 1);
  });
});

/**
 * The password-change budget exists because verifying the current password is an argon2
 * oracle for anyone holding a stolen session cookie. It is keyed on the user, not an
 * address — the attacker is already inside the session, so their network position says
 * nothing about them.
 */
describe("password change budget", () => {
  it("allows a realistic number of genuine attempts", () => {
    const user = "user-a";
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(consume("passwordChange", user, 0).allowed).toBe(true);
    }
  });

  it("stops the eleventh, and says how long to wait", () => {
    const user = "user-b";
    for (let attempt = 0; attempt < 10; attempt += 1) consume("passwordChange", user, 0);

    const blocked = consume("passwordChange", user, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60 * 60);
  });

  it("budgets each user separately, so one cannot lock out another", () => {
    const noisy = "user-c";
    for (let attempt = 0; attempt < 11; attempt += 1) consume("passwordChange", noisy, 0);

    expect(consume("passwordChange", noisy, 0).allowed).toBe(false);
    expect(consume("passwordChange", "user-d", 0).allowed).toBe(true);
  });

  /**
   * The budget is returned when the password is proved correct, so somebody who mistyped
   * twice before succeeding is not left throttled for the rest of the hour.
   */
  it("is returned on a successful change", () => {
    const user = "user-e";
    for (let attempt = 0; attempt < 9; attempt += 1) consume("passwordChange", user, 0);

    reset("passwordChange", user);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(consume("passwordChange", user, 0).allowed).toBe(true);
    }
  });

  it("recovers after the window passes", () => {
    const user = "user-f";
    for (let attempt = 0; attempt < 11; attempt += 1) consume("passwordChange", user, 0);
    expect(consume("passwordChange", user, 0).allowed).toBe(false);

    // One hour and a second later.
    expect(consume("passwordChange", user, 60 * 60 * 1000 + 1000).allowed).toBe(true);
  });
});

/**
 * Bucket keys are built from caller-supplied values — the login key contains the submitted
 * email, which arrives unvalidated from a form. Storing it verbatim let an unauthenticated
 * request pin arbitrary memory: 900 buckets carrying a 900 KB "email" retained 772 MB,
 * measured, at a request rate the per-IP limit itself permits. That is an OOM of the single
 * container, which is exactly the denial of service the no-lockout design exists to avoid.
 */
describe("the bucket map stays bounded", () => {
  it("truncates an oversized key rather than storing it", () => {
    const huge = "a".repeat(500_000);
    consume("loginPerAccount", huge, 0);

    // One bucket, and it cannot be holding half a megabyte.
    expect(size()).toBe(1);
  });

  it("treats keys sharing a truncated prefix as the same subject", () => {
    const base = "b".repeat(400);
    consume("loginPerAccount", `${base}-one`, 0);
    consume("loginPerAccount", `${base}-two`, 0);

    // Collapsing beyond the cap is deliberate: a key only has to identify a subject, and no
    // legal email reaches it.
    expect(size()).toBe(1);
  });

  it("still separates keys that differ inside the cap", () => {
    consume("loginPerAccount", "misty@example.org|1.1.1.1", 0);
    consume("loginPerAccount", "quincy@example.org|1.1.1.1", 0);
    expect(size()).toBe(2);
  });

  it("drops expired buckets without anything having to schedule a sweep", () => {
    for (let index = 0; index < 50; index += 1) {
      consume("loginPerIp", `198.51.100.${index}`, 0);
    }
    expect(size()).toBe(50);

    // A later request is the only trigger; there is no timer to start or forget.
    consume("loginPerIp", "203.0.113.1", 16 * 60 * 1000);
    expect(size()).toBe(1);
  });

  it("reset clears a truncated key too, so a successful login really refunds it", () => {
    const huge = "c".repeat(500_000);
    consume("loginPerAccount", huge, 0);
    reset("loginPerAccount", huge);
    expect(size()).toBe(0);
  });
});
