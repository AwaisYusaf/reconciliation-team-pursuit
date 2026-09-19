import "server-only";

/**
 * Share-link tokens (PHASE-12 P3, D-112): twelve characters of `[0-9A-Za-z]`, about 71 bits.
 *
 * The ticket's example was nine characters (about 53 bits), thin for a public link with no
 * account behind it and a 73 MB financial file behind the door. Twelve is still short enough
 * to read out or type.
 */
import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const SHARE_TOKEN_LENGTH = 12;

/** The same rule as `shared_links_token_ck`, checked before any lookup touches the database. */
const TOKEN_PATTERN = /^[0-9A-Za-z]{12}$/;

/**
 * 62 × 4. A byte at or above it is dropped rather than folded in with `% 62`, which would make
 * the first eight characters of the alphabet slightly likelier than the rest.
 */
const UNBIASED_LIMIT = 248;

/** A fresh token. `random` is injectable so the rejection step can be tested. */
export function generateShareToken(random: (size: number) => Buffer = randomBytes): string {
  let token = "";
  while (token.length < SHARE_TOKEN_LENGTH) {
    for (const byte of random(SHARE_TOKEN_LENGTH * 2)) {
      if (byte >= UNBIASED_LIMIT) continue;
      token += ALPHABET[byte % ALPHABET.length];
      if (token.length === SHARE_TOKEN_LENGTH) break;
    }
  }
  return token;
}

export function isShareToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
