/**
 * In-process fixed-window rate limiting (architecture §Application layout).
 *
 * Sized for this deployment: one container, one organisation, a handful of users. It
 * bounds password-guessing and the CPU cost of argon2 verification without adding a
 * Redis dependency. If the app is ever scaled to multiple instances, this must move to
 * a shared store — the limits are per process.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Longest subject key retained.
 *
 * Keys are built from caller-supplied values — a login key contains the submitted email,
 * which arrives unvalidated from a form. Storing it verbatim let an unauthenticated request
 * pin arbitrary memory: 900 buckets carrying a 900 KB "email" retained 772 MB, measured, at
 * a request rate the per-IP limit itself permits. Truncating is safe because a key only has
 * to identify a subject, and 320 characters is beyond the longest legal address (RFC 5321
 * caps a path at 256).
 */
const MAX_KEY_LENGTH = 320;

/**
 * Buckets are swept lazily rather than on a timer, so there is no interval to own, nothing
 * to start at boot, and no behaviour that differs between a warm and a cold process.
 */
const SWEEP_EVERY_MS = 60 * 1000;
let lastSweep = 0;

/** Hard backstop: if the map ever grows past this, drop everything expired immediately. */
const SWEEP_AT_ENTRIES = 5_000;

/** Named limits, all fixed-window. */
export const LIMITS = {
  /** Per email + IP — the targeted-guessing case. */
  loginPerAccount: { limit: 10, windowMs: 15 * 60 * 1000 },
  /** Per IP regardless of email — bounds argon2 CPU when an attacker rotates emails. */
  loginPerIp: { limit: 30, windowMs: 15 * 60 * 1000 },
  /**
   * Uploads, per organisation.
   *
   * Sized against the per-expense budget rather than against a guess: F1 raised that to
   * 200 MB / 300 pages precisely so a month of rideshare receipts fits on one expense, and
   * at 60/min the flush stalled around the sixtieth file — the very case the change exists
   * to enable (D-73).
   *
   * Raising it is safe because it was never the binding guard. Storage is bounded by the
   * per-expense and per-organisation byte caps (R13.1), and CPU by the fact that the client
   * posts files one at a time and awaits each: the burst this limit imagines never happens
   * from the app. It remains as a backstop against a script.
   */
  presign: { limit: 400, windowMs: 60 * 1000 },
  /** Document generation, per organisation. */
  generate: { limit: 6, windowMs: 60 * 1000 },
  /**
   * Password change, per user.
   *
   * The current password is verified before the new one is accepted, so without a bound
   * anyone holding a stolen session cookie has an unlimited argon2 oracle against it. Ten
   * genuine attempts in an hour is far more than a person needs and far less than a guessing
   * run requires.
   */
  passwordChange: { limit: 10, windowMs: 60 * 60 * 1000 },
  /**
   * Signup, per address.
   *
   * Every attempt reaches argon2 hashing on the same libuv threadpool that login's
   * verification uses, so an unauthenticated flood here starves sign-in for the staff. The
   * gate is normally closed (D-15); this bounds the window while it is open to provision
   * the client's organisation.
   */
  signUp: { limit: 5, windowMs: 60 * 60 * 1000 },
  /**
   * Creating a user or setting someone's password, per admin (D-85).
   *
   * Same argon2 threadpool as login and for the same reason as `passwordChange`: these are
   * the only authenticated paths that hash, so a stolen admin cookie would otherwise be an
   * unbounded way to starve sign-in for everyone else. An admin provisioning real people
   * never approaches this in an hour.
   */
  userProvisioning: { limit: 20, windowMs: 60 * 60 * 1000 },
  /**
   * Reading amounts from a document (Phase 10), per organisation.
   *
   * Each call reaches OpenAI and is billed, unlike `presign` which only stores a file — so this
   * bounds spend from a script hammering the route rather than from ordinary use. 200/hour is
   * far more than a person reviewing receipts reaches, and every call is logged regardless.
   */
  readAmounts: { limit: 200, windowMs: 60 * 60 * 1000 },
  /**
   * Reading a multi-line invoice (Phase 14), per organisation.
   *
   * Tighter than `readAmounts`: one call sends up to 10 billed PDF pages (`MAX_PAGES_READ`) and
   * allows 4000 output tokens for up to 50 lines, so it costs roughly an order of magnitude more
   * than a single receipt read. A person adding invoices does a handful an hour, not hundreds.
   */
  readInvoice: { limit: 20, windowMs: 60 * 60 * 1000 },
  /**
   * Writing a monthly summary (Phase 11), per organisation.
   *
   * Same reasoning as `readAmounts`: each call reaches OpenAI and is billed. 30/hour is far
   * more than a real write-plus-one-retry workflow reaches for any one org, and every run is
   * logged regardless (P11).
   */
  summaryWrite: { limit: 30, windowMs: 60 * 60 * 1000 },
  /**
   * Password tries on a shared link, per link and visitor address (PHASE-12 P2).
   *
   * Keyed by both so one visitor's wrong guesses never lock another out (D-44): the City's
   * reviewer on their own network is unaffected by anyone else guessing. Checked before the
   * password, so the sixth try is refused even when it is right.
   */
  sharePasswordPerLinkIp: { limit: 5, windowMs: 15 * 60 * 1000 },
  /**
   * Password tries per address across every link — bounds argon2 work from one address, as
   * `loginPerIp` does for sign-in. Deliberately no per-link limit across addresses: that would
   * let anyone holding the link, from enough addresses, lock the recipient out.
   */
  sharePasswordPerIp: { limit: 30, windowMs: 15 * 60 * 1000 },
  /**
   * Opens of a shared file, per address — a backstop against a script re-pulling a 70 MB packet
   * (PHASE-12 P10). One open is one request, since the file is served without ranges.
   */
  shareOpen: { limit: 60, windowMs: 15 * 60 * 1000 },
  /**
   * Setting a shared link's password, per user: each one is an argon2 hash on the threadpool
   * sign-in uses, the same reasoning as `userProvisioning`.
   */
  sharePasswordSet: { limit: 20, windowMs: 60 * 60 * 1000 },
} as const;

export type LimitName = keyof typeof LIMITS;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets — for user-facing "try again in…" copy. */
  retryAfterSeconds: number;
};

/**
 * Consume one unit from a bucket.
 *
 * `key` should identify the subject being limited (an email, an IP, an org id). Keys are
 * namespaced by limit name, so the same subject can hold independent budgets.
 */
export function consume(name: LimitName, key: string, now: number = Date.now()): RateLimitResult {
  const { limit, windowMs } = LIMITS[name];

  // Sweeping here rather than on a timer keeps the map bounded without anything having to
  // remember to start a sweeper. Expired buckets are dead weight the moment they lapse.
  if (now - lastSweep >= SWEEP_EVERY_MS || buckets.size >= SWEEP_AT_ENTRIES) {
    sweep(now);
    lastSweep = now;
  }

  const bucketKey = `${name}:${key.slice(0, MAX_KEY_LENGTH)}`;
  const existing = buckets.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds: 0,
  };
}

/** Forget a subject's usage — called after a successful login so honest users reset. */
export function reset(name: LimitName, key: string): void {
  buckets.delete(`${name}:${key.slice(0, MAX_KEY_LENGTH)}`);
}

/** Drop expired buckets so the map cannot grow without bound. */
export function sweep(now: number = Date.now()): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Current bucket count — for the tests that assert the map stays bounded. */
export function size(): number {
  return buckets.size;
}

/** Test seam only. */
export function clearAll(): void {
  lastSweep = 0;
  buckets.clear();
}
