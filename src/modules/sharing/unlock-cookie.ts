import "server-only";

/**
 * Remembering that a visitor typed a shared link's password (PHASE-12 P6).
 *
 * The cookie carries `v1.{expiry}.{signature}`, the signature an HMAC over the share's id, its
 * current password hash and the expiry, keyed from `AUTH_SECRET`. Binding the password hash is
 * what makes a password change end every earlier unlock at once (Appendix A §3): argon2 salts
 * every hash afresh, so even setting the same password again produces a different hash. Stopping
 * the link needs nothing here — every request looks the share up again.
 *
 * Scoped to `Path=/s/{token}`, so each link has its own cookie and it reaches both the password
 * page and the file URL. SameSite=Lax: Strict would drop it on the next click from an email.
 */
import { timingSafeEqual } from "node:crypto";

import { signWithAuthSecret } from "@/src/services/auth/tokens";

/** "The visitor shouldn't have to enter the password again for a while" — twelve hours. */
export const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;

const PRODUCTION = process.env.NODE_ENV === "production";

/**
 * `__Secure-` needs https, which local development doesn't have. `__Host-` is not possible:
 * it requires `Path=/`, and this cookie is scoped to one link's path.
 */
export const UNLOCK_COOKIE = PRODUCTION ? "__Secure-share_unlock" : "share_unlock";

const VERSION = "v1";

type UnlockSubject = { id: string; passwordHash: string };

function signature(subject: UnlockSubject, expiresAt: number): string {
  return signWithAuthSecret("share-unlock", `${subject.id}|${subject.passwordHash}|${expiresAt}`);
}

/** The cookie to set once the right password has been typed. */
export function unlockCookie(
  subject: UnlockSubject & { token: string },
  now: number = Date.now(),
): {
  name: string;
  value: string;
  options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: string; expires: Date };
} {
  const expiresAt = now + UNLOCK_TTL_MS;
  return {
    name: UNLOCK_COOKIE,
    value: `${VERSION}.${expiresAt}.${signature(subject, expiresAt)}`,
    options: {
      httpOnly: true,
      secure: PRODUCTION,
      sameSite: "lax",
      path: `/s/${subject.token}`,
      expires: new Date(expiresAt),
    },
  };
}

/** Whether a cookie value unlocks this share right now. Malformed or foreign values never do. */
export function isUnlocked(
  subject: UnlockSubject,
  value: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION || !/^\d{1,15}$/.test(parts[1])) return false;

  const expiresAt = Number(parts[1]);
  // Expired, or claiming a lifetime no cookie of ours was ever given.
  if (expiresAt <= now || expiresAt > now + UNLOCK_TTL_MS) return false;

  const expected = Buffer.from(signature(subject, expiresAt));
  const given = Buffer.from(parts[2]);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
