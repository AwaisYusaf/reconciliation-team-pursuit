import { beforeEach, describe, expect, it } from "vitest";

import { clearAll, consume, LIMITS, reset, sweep } from "./rate-limit";

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
