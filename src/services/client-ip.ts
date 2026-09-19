import "server-only";

/**
 * The client's IP, for rate limiting.
 *
 * Moved out of `src/modules/auth/actions.ts` (PHASE-12): a `"use server"` file publishes every
 * export as a callable action, so the helper could not be shared from there. Sign-in and sign-up
 * call `clientIp()`; the public share routes pass their request's headers to `clientIpFrom`.
 *
 * `X-Forwarded-For` is appended to by each hop, so the LAST entries are the ones our own
 * proxies wrote and the leftmost are attacker-controlled. Taking the leftmost value let an
 * attacker mint a fresh rate-limit bucket per request simply by varying the header, which
 * defeated the login limiter entirely — and that limiter is deliberately the only
 * brute-force bound, since lockout would be a denial of service against a shared account.
 *
 * `TRUSTED_PROXY_HOPS` says how many reverse proxies sit in front of the app (Caddy or
 * nginx terminating TLS is 1). We count that many entries back from the right. With no
 * proxies configured the header is ignored altogether.
 */
import { headers } from "next/headers";

/**
 * Whether a proxy-supplied value is plausibly an address.
 *
 * Deliberately permissive about *which* address — the point is only that a caller cannot
 * substitute unbounded arbitrary text for their identity, not to parse every IPv6 form.
 */
function isIpAddress(value: string): boolean {
  if (value.length > 45) return false; // longest IPv6 with an embedded IPv4
  return /^[0-9a-fA-F:.]+$/.test(value) && /[0-9a-fA-F]/.test(value);
}

/** The client's IP from a request's headers — for route handlers, which have the request. */
export function clientIpFrom(store: { get(name: string): string | null | undefined }): string {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");

  if (hops > 0) {
    const forwarded = store.get("x-forwarded-for");
    if (forwarded) {
      const entries = forwarded.split(",").map((entry) => entry.trim()).filter(Boolean);
      const candidate = entries[entries.length - hops];
      if (candidate && isIpAddress(candidate)) return candidate;
    }
    // Only accepted when it actually looks like an address. Unvalidated, this header let a
    // caller send a fresh nonce per request, landing every attempt in a virgin bucket and
    // making both login budgets unreachable — unbounded guessing against the one shared
    // account, behind which there is deliberately no lockout.
    const real = store.get("x-real-ip")?.trim();
    if (real && isIpAddress(real)) return real;
  }

  // Without a proxy count the client cannot be identified, so every visitor shares one
  // bucket — which turns the per-account limit into a weapon: an attacker's wrong guesses
  // lock the real user out, exactly the denial of service the no-lockout design avoids.
  // Production refuses to run that way, the same as it refuses the local storage driver.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "TRUSTED_PROXY_HOPS must be set in production — without it login rate limits cannot " +
        "tell clients apart and become an account lockout. Set it to the number of reverse " +
        "proxies in front of the app (Caddy or nginx terminating TLS is 1).",
    );
  }
  return "direct";
}

/**
 * The subject a per-address limit counts against: an IPv4 address as is, an IPv6 address by its
 * /64 prefix.
 *
 * One IPv6 subscriber is usually handed a whole /64, so keying on the full address would give
 * them billions of fresh budgets — unlimited guesses at a shared link's password (PHASE-12
 * review). Used by the shared-link limits; the login limits still key on the full address, as
 * they always have.
 */
export function rateLimitSubject(ip: string): string {
  if (!ip.includes(":")) return ip;
  // An IPv4 address written as IPv6 (`::ffff:203.0.113.9`) is still one IPv4 client. Grouped by
  // its /64 it would share one budget with every other IPv4 visitor, so one visitor's wrong
  // guesses could lock everyone out — the thing D-44 forbids.
  const embeddedV4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (embeddedV4) return embeddedV4[1];
  const [head] = ip.split("%"); // drop a zone index
  const [left, right = ""] = head.split("::");
  const leftGroups = left ? left.split(":") : [];
  const rightGroups = right ? right.split(":") : [];
  const missing = head.includes("::") ? 8 - leftGroups.length - rightGroups.length : 0;
  const groups = [...leftGroups, ...Array(Math.max(missing, 0)).fill("0"), ...rightGroups];
  const prefix = groups
    .slice(0, 4)
    .map((group) => (parseInt(group || "0", 16) || 0).toString(16))
    .join(":");
  return `${prefix}::/64`;
}

/** The client's IP for the current request — for Server Actions, which have no request object. */
export async function clientIp(): Promise<string> {
  return clientIpFrom(await headers());
}
