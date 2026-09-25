// Ported from the reference build's lib/small.test.ts config section (Phase 15 §12),
// node:test → vitest; `readConfig`'s single throw becomes `billingConfigProblems`'s array, and
// billing off returning `[]` is new (P25: a deployment with no Stripe keys must still boot).
import { describe, expect, it } from "vitest";

import { billingConfigProblems, billingEnabled, STRIPE_API_VERSION } from "./config";

describe("billingEnabled", () => {
  it("is false unless BILLING_ENABLED is exactly 'true'", () => {
    const original = process.env.BILLING_ENABLED;
    try {
      delete process.env.BILLING_ENABLED;
      expect(billingEnabled()).toBe(false);
      process.env.BILLING_ENABLED = "false";
      expect(billingEnabled()).toBe(false);
      process.env.BILLING_ENABLED = "TRUE";
      expect(billingEnabled()).toBe(false);
      process.env.BILLING_ENABLED = "1";
      expect(billingEnabled()).toBe(false);
      process.env.BILLING_ENABLED = " true";
      expect(billingEnabled()).toBe(false);
      process.env.BILLING_ENABLED = "true ";
      expect(billingEnabled()).toBe(false);
      process.env.BILLING_ENABLED = "true";
      expect(billingEnabled()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.BILLING_ENABLED;
      else process.env.BILLING_ENABLED = original;
    }
  });
});

describe("STRIPE_API_VERSION", () => {
  it("is pinned (P26)", () => {
    expect(STRIPE_API_VERSION).toBe("2026-08-26.dahlia");
  });
});

describe("billingConfigProblems", () => {
  it("billing off: no problems, whatever else is set", () => {
    expect(billingConfigProblems({})).toEqual([]);
    expect(billingConfigProblems({ BILLING_ENABLED: "false" })).toEqual([]);
    expect(billingConfigProblems({ STRIPE_SECRET_KEY: "not a key" })).toEqual([]);
  });

  const on = { BILLING_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_abc123", STRIPE_WEBHOOK_SECRET: "whsec_x" };

  it("billing on: a valid test key and webhook secret pass", () => {
    expect(billingConfigProblems(on)).toEqual([]);
  });

  it("a restricted rk_ key passes too", () => {
    expect(billingConfigProblems({ ...on, STRIPE_SECRET_KEY: "rk_test_abc123" })).toEqual([]);
  });

  it("a live rk_ key with a valid https APP_URL passes", () => {
    expect(
      billingConfigProblems({ ...on, STRIPE_SECRET_KEY: "rk_live_abc123", APP_URL: "https://app.example.com" }),
    ).toEqual([]);
  });

  it("a test-mode key needs no https APP_URL, even over http", () => {
    expect(billingConfigProblems({ ...on, APP_URL: "http://localhost:3000" })).toEqual([]);
  });

  it("whitespace-only STRIPE_SECRET_KEY is refused (trimmed to empty, doesn't match the regex)", () => {
    const problems = billingConfigProblems({ ...on, STRIPE_SECRET_KEY: "   " });
    expect(problems.some((p) => p.includes("STRIPE_SECRET_KEY"))).toBe(true);
  });

  it("a key with surrounding whitespace is trimmed and accepted", () => {
    expect(billingConfigProblems({ ...on, STRIPE_SECRET_KEY: "  sk_test_abc123  " })).toEqual([]);
  });

  it("a missing STRIPE_SECRET_KEY entirely (undefined) is refused", () => {
    const rest = { ...on, STRIPE_SECRET_KEY: undefined };
    expect(billingConfigProblems(rest).some((p) => p.includes("STRIPE_SECRET_KEY"))).toBe(true);
  });

  it("a missing STRIPE_WEBHOOK_SECRET entirely (undefined) is refused", () => {
    const rest = { ...on, STRIPE_WEBHOOK_SECRET: undefined };
    expect(billingConfigProblems(rest).some((p) => p.includes("STRIPE_WEBHOOK_SECRET"))).toBe(true);
  });

  it("a whitespace-only STRIPE_WEBHOOK_SECRET is refused", () => {
    expect(billingConfigProblems({ ...on, STRIPE_WEBHOOK_SECRET: "   " }).some((p) => p.includes("STRIPE_WEBHOOK_SECRET"))).toBe(
      true,
    );
  });

  it("a publishable key is refused", () => {
    expect(
      billingConfigProblems({ ...on, STRIPE_SECRET_KEY: "pk_test_abc123" }).some((p) => p.includes("STRIPE_SECRET_KEY")),
    ).toBe(true);
  });

  it("an empty key is refused", () => {
    const problems = billingConfigProblems({ ...on, STRIPE_SECRET_KEY: "" });
    expect(problems.some((p) => p.includes("STRIPE_SECRET_KEY"))).toBe(true);
  });

  it("a webhook secret without whsec_ or with nothing after it is refused", () => {
    expect(billingConfigProblems({ ...on, STRIPE_WEBHOOK_SECRET: "abc" }).some((p) => p.includes("STRIPE_WEBHOOK_SECRET"))).toBe(true);
    expect(billingConfigProblems({ ...on, STRIPE_WEBHOOK_SECRET: "whsec_" }).some((p) => p.includes("STRIPE_WEBHOOK_SECRET"))).toBe(true);
  });

  it("a live key needs an https APP_URL", () => {
    const live = { ...on, STRIPE_SECRET_KEY: "sk_live_abc123" };
    expect(billingConfigProblems(live).some((p) => p.includes("APP_URL"))).toBe(true);
    expect(billingConfigProblems({ ...live, APP_URL: "http://example.com" }).some((p) => p.includes("APP_URL"))).toBe(true);
    expect(billingConfigProblems({ ...live, APP_URL: "https://app.example.com" })).toEqual([]);
  });

  it("a test key needs no APP_URL", () => {
    expect(billingConfigProblems(on)).toEqual([]);
  });

  it("every problem is reported at once, and messages never include a value", () => {
    const problems = billingConfigProblems({
      BILLING_ENABLED: "true",
      STRIPE_SECRET_KEY: "pk_test_SECRET_VALUE",
      STRIPE_WEBHOOK_SECRET: "SECRET_VALUE",
    });
    expect(problems.length).toBe(2);
    for (const p of problems) expect(p).not.toContain("SECRET_VALUE");
  });
});
