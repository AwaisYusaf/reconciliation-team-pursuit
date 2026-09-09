/**
 * Password hashing and policy (architecture §Auth, D-24).
 *
 * argon2id with OWASP's recommended minimum parameters. The policy is deliberately
 * simple — a 12-character minimum and nothing else — because composition rules push
 * people toward predictable substitutions without adding real entropy. Brute force is
 * bounded by the login rate limiter rather than by lockout, since a single shared
 * account per organisation means lockout is a denial of service against the client.
 */
import { randomBytes } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";

/** Minimum password length (D-24, raised from the prototype's 8). */
export const MIN_PASSWORD_LENGTH = 12;

/** OWASP-recommended argon2id parameters: 19 MiB, 2 iterations, 1 lane. */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hash a plaintext password for storage. */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash.
 * Never throws on a malformed hash — a corrupt row must read as "wrong password",
 * not as a server error that leaks which accounts have broken data.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/** Readable but strong: 32 base64url characters, well past the 12-character policy. */
export function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

/** Returns an error message when the password fails policy, or null when it passes. */
export function validatePasswordPolicy(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
