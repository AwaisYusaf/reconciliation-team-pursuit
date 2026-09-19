/**
 * `clientIpFrom` — moved out of the sign-in actions (PHASE-12) so the public share routes can key
 * their password limits on it. These are the cases the login limiter already depended on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { clientIpFrom } from "./client-ip";

function headersOf(values: Record<string, string>) {
  return new Headers(values);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIpFrom", () => {
  it("counts back from the right by the trusted hop count, so a forged leftmost entry is ignored", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(clientIpFrom(headersOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(clientIpFrom(headersOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip only when it looks like an address", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(clientIpFrom(headersOf({ "x-forwarded-for": "not-an-ip", "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIpFrom(headersOf({ "x-real-ip": "nonce-per-request" }))).toBe("direct");
  });

  it("ignores the headers entirely without a proxy count, outside production", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    expect(clientIpFrom(headersOf({ "x-forwarded-for": "203.0.113.9" }))).toBe("direct");
  });

  it("refuses to guess in production without a proxy count", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => clientIpFrom(headersOf({}))).toThrow(/TRUSTED_PROXY_HOPS must be set/);
  });

  it("refuses an over-long value that could pin memory in the limiter", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(clientIpFrom(headersOf({ "x-forwarded-for": "1".repeat(46) }))).toBe("direct");
  });
});
