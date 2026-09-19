/**
 * P1: production refuses to start without a usable https APP_URL — every shared link is built
 * from it. `instrumentation.ts` sits at the repo root, outside vitest's `src/**` include, so it is
 * exercised from here.
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
