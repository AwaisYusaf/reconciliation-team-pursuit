/**
 * P1: production refuses to start without a usable https APP_URL — every shared link is built
 * from it. `instrumentation.ts` sits at the repo root, outside vitest's `src/**` include, so it is
 * exercised from here.
 *
 * The `register (billing)` block below (Phase 15, P25) covers the billing check that runs
 * BEFORE both the NODE_ENV early return and the checks above: a broken Stripe key must fail
 * startup the same way in development as it would in production.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { register } from "@/instrumentation";

const REQUIRED = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://example/db",
  AUTH_SECRET: "x".repeat(48),
  S3_BUCKET: "bucket",
  TRUSTED_PROXY_HOPS: "1",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("register (production)", () => {
  it("starts with an https APP_URL", async () => {
    for (const [key, value] of Object.entries(REQUIRED)) vi.stubEnv(key, value);
    vi.stubEnv("APP_URL", "https://stayfunded360.com");
    await expect(register()).resolves.toBeUndefined();
  });

  it.each([
    ["missing", "", /APP_URL/],
    ["not a URL", "stayfunded360.com", /APP_URL is unusable/],
    ["plain http", "http://stayfunded360.com", /not an https address/],
  ])("refuses to start when APP_URL is %s", async (_, value, message) => {
    for (const [key, env] of Object.entries(REQUIRED)) vi.stubEnv(key, env);
    vi.stubEnv("APP_URL", value);
    await expect(register()).rejects.toThrow(message);
  });
});

describe("register (billing, Phase 15 P25)", () => {
  it("BILLING_ENABLED unset, NODE_ENV test (the ambient state): resolves", async () => {
    vi.stubEnv("BILLING_ENABLED", undefined);
    vi.stubEnv("STRIPE_SECRET_KEY", undefined);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", undefined);
    expect(process.env.NODE_ENV).toBe("test");
    await expect(register()).resolves.toBeUndefined();
  });

  it("billing on with bad keys rejects, listing every problem, and never leaks the secret values", async () => {
    vi.stubEnv("BILLING_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "pk_test_TOTALLY_SECRET_VALUE_1");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "not-whsec-TOTALLY_SECRET_VALUE_2");
    let message = "";
    try {
      await register();
      throw new Error("register() should have rejected");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("STRIPE_SECRET_KEY");
    expect(message).toContain("STRIPE_WEBHOOK_SECRET");
    expect(message).not.toContain("TOTALLY_SECRET_VALUE_1");
    expect(message).not.toContain("TOTALLY_SECRET_VALUE_2");
  });

  it("billing on with valid test keys in a non-production NODE_ENV resolves", async () => {
    vi.stubEnv("BILLING_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_abc123");
    expect(process.env.NODE_ENV).toBe("test"); // not "production": the checks above are skipped
    await expect(register()).resolves.toBeUndefined();
  });

  it("billing on with a live key on http rejects even outside production (dev must fail the same way)", async () => {
    vi.stubEnv("BILLING_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc123");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_abc123");
    vi.stubEnv("APP_URL", undefined);
    await expect(register()).rejects.toThrow(/APP_URL/);
  });
});
