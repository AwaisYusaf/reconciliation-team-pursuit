/**
 * Session token handling — pure functions, no IO (architecture §Auth, D-06).
 *
 * The cookie carries a 32-byte random token. The database stores only its SHA-256,
 * so a database leak cannot be turned into forged cookies. Expiry is a 30-day
 * sliding window, renewed once a session is inside the final 15 days.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Cookie name for the session token. */
export const SESSION_COOKIE = "session";

/** Full session lifetime (R: architecture §Auth — 30-day sliding TTL). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Renew once the remaining lifetime drops below this. */
export const SESSION_RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

/** Generate a new opaque session token (256 bits of entropy), base64url encoded. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The database key for a token: its SHA-256, hex encoded.
 * The raw token exists only in the cookie and in transit.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of two token hashes, for callers that compare directly. */
export function tokenHashesEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Expiry instant for a session created now. */
export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

/** True once the session's expiry has passed. Expiry is exclusive: at the instant it expires, it is expired. */
export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * True when a still-valid session is inside its final 15 days and should have its
 * expiry pushed back out to a full 30 days (sliding window).
 */
export function needsRenewal(expiresAt: Date, now: Date = new Date()): boolean {
  if (isExpired(expiresAt, now)) return false;
  return expiresAt.getTime() - now.getTime() < SESSION_RENEW_THRESHOLD_MS;
}

/** Cookie options for the session cookie. `secure` is disabled only for local http development. */
export function sessionCookieOptions(now: Date = new Date()): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  expires: Date;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: sessionExpiry(now),
  };
}
