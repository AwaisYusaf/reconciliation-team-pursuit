/**
 * Startup configuration check.
 *
 * `register` runs once per server instance and must complete before any request is served,
 * which is the only place a "refuses to start" guarantee can actually be made. Several
 * settings were previously checked at first use instead: a misconfigured deployment booted
 * cleanly, served the login page, and then failed with an error boundary the moment somebody
 * tried to sign in or download something. The documentation claimed otherwise, so the claim
 * is made true here rather than softened.
 *
 * Development is left alone deliberately — the whole point of the local storage driver and
 * the fallback session secret is that the app runs with no configuration at all.
 */

/** Settings that must be present before production serves a single request. */
const REQUIRED_IN_PRODUCTION: Array<{ name: string; why: string }> = [
  {
    name: "DATABASE_URL",
    why: "there is nothing to read or write without it",
  },
  {
    name: "AUTH_SECRET",
    why: "it keys session tokens, and rotating it is the only way to revoke every session at once",
  },
  {
    name: "S3_BUCKET",
    why: "without it uploads would be written to the container's local disk and lost on redeploy",
  },
  {
    name: "TRUSTED_PROXY_HOPS",
    why:
      "login rate limits are keyed on the client address; without it every visitor shares one " +
      "bucket, so an attacker's wrong guesses lock out the real user",
  },
];

export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  const missing = REQUIRED_IN_PRODUCTION.filter(({ name }) => !process.env[name]);

  if (missing.length > 0) {
    const detail = missing.map(({ name, why }) => `  ${name} — ${why}`).join("\n");
    throw new Error(
      `Refusing to start: ${missing.length} required setting${missing.length === 1 ? " is" : "s are"} missing.\n${detail}\n` +
        "See .env.example for the full list.",
    );
  }

  // A wrong hop count is worse than none: it makes a forged X-Forwarded-For trustworthy.
  const hops = Number(process.env.TRUSTED_PROXY_HOPS);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
    throw new Error(
      `Refusing to start: TRUSTED_PROXY_HOPS is "${process.env.TRUSTED_PROXY_HOPS}", which is not ` +
        "a plausible number of reverse proxies. Set it to how many actually sit in front of " +
        "the app (Caddy or nginx terminating TLS is 1).",
    );
  }
}
