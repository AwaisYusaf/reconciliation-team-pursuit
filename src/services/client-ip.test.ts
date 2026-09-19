/**
 * `clientIpFrom` — moved out of the sign-in actions (PHASE-12) so the public share routes can key
 * their password limits on it. These are the cases the login limiter already depended on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { clientIpFrom, rateLimitSubject } from "./client-ip";

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

describe("rateLimitSubject", () => {
  it("keeps an IPv4 address whole", () => {
    expect(rateLimitSubject("203.0.113.9")).toBe("203.0.113.9");
  });

  it("groups an IPv6 address by its /64, however it is written", () => {
    const subject = "2001:db8:85a3:0::/64";
    expect(rateLimitSubject("2001:db8:85a3::1")).toBe(subject);
    expect(rateLimitSubject("2001:0db8:85a3:0000:ffff:ffff:ffff:ffff")).toBe(subject);
    expect(rateLimitSubject("2001:db8:85a3:0:1:2:3:4")).toBe(subject);
    expect(rateLimitSubject("fe80::1%en0")).toBe("fe80:0:0:0::/64");
  });

  it("keeps an IPv4 address written as IPv6 separate from other IPv4 visitors", () => {
    expect(rateLimitSubject("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(rateLimitSubject("::ffff:203.0.113.10")).not.toBe(rateLimitSubject("::ffff:203.0.113.9"));
  });

  it("gives different /64s different subjects", () => {
    expect(rateLimitSubject("2001:db8:85a3:1::1")).not.toBe(rateLimitSubject("2001:db8:85a3:2::1"));
  });
});
