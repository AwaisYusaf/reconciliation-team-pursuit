/**
 * Session token handling — pure functions, no IO (architecture §Auth, D-06).
 *
 * The cookie carries a 32-byte random token. The database stores an HMAC of it keyed by
 * `AUTH_SECRET`, so a database leak cannot be turned into forged cookies — and rotating the
 * secret invalidates every session at once. That rotation is the point: with one shared
 * account, no self-serve reset (D-24) and no session-list UI, "sign everybody out now" is
 * the operator's only lever after a suspected cookie compromise, and it has to actually
 * work. The variable was documented as doing this before anything read it.
 *
 * Expiry is a 30-day sliding window, renewed once a session is inside the final 15 days,
 * with an absolute cap so a token touched monthly cannot live forever.
 */
import { createHmac, randomBytes } from "node:crypto";

/** Cookie name for the session token. */
export const SESSION_COOKIE =
  // The `__Host-` prefix is enforced by the browser: it refuses the cookie unless it is
  // Secure, Path=/ and has no Domain — which this one already satisfies. It closes
  // subdomain cookie-shadowing, where a compromised sibling host sets a session cookie the
  // main host would otherwise accept. Dropped outside production because the prefix also
  // requires https, which local development does not use.
  process.env.NODE_ENV === "production" ? "__Host-session" : "session";

/** Full session lifetime (R: architecture §Auth — 30-day sliding TTL). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Hard ceiling on a session's total age, regardless of renewal.
 *
 * Without it the sliding window has no end: a stolen cookie touched once a month stays valid
 * indefinitely, and the staff have no UI that would reveal or end it.
 */
export const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** True once a session has outlived the absolute cap, however recently it was renewed. */
export function exceedsMaxAge(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() >= SESSION_MAX_AGE_MS;
}

/** Renew once the remaining lifetime drops below this. */
export const SESSION_RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

/** Generate a new opaque session token (256 bits of entropy), base64url encoded. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The signing key.
 *
 * Required in production — an absent secret there would silently make every session
 * forgeable-by-rotation-accident and, worse, make the documented revocation lever a no-op.
 * Development falls back to a fixed string so the app runs with no configuration.
 */
function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET must be set in production. It keys session tokens, and rotating it is " +
        "the only way to revoke every session at once.",
    );
  }
  return "local-development-session-secret";
}

/**
 * The database key for a token: an HMAC-SHA256 keyed by `AUTH_SECRET`, hex encoded.
 * The raw token exists only in the cookie and in transit.
 */
export function hashSessionToken(token: string): string {
  return createHmac("sha256", authSecret()).update(token, "utf8").digest("hex");
}

/**
 * An HMAC-SHA256 over `data`, keyed by a key derived from `AUTH_SECRET` for one named purpose,
 * base64url encoded (PHASE-12: the shared-link unlock cookie).
 *
 * The per-purpose key keeps signatures from different features from ever being interchangeable,
 * or equal to a session token's database key. Unlike the signed-URL helpers D-41 removed, this
 * has a caller and signs something the server itself checks. Rotating `AUTH_SECRET` voids every
 * signature, as it does every session.
 */
export function signWithAuthSecret(purpose: string, data: string): string {
  const key = createHmac("sha256", authSecret()).update(`purpose:${purpose}`, "utf8").digest();
  return createHmac("sha256", key).update(data, "utf8").digest("base64url");
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
