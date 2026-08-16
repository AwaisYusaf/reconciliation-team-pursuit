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

/** Named limits, all fixed-window. */
export const LIMITS = {
  /** Per email + IP — the targeted-guessing case. */
  loginPerAccount: { limit: 10, windowMs: 15 * 60 * 1000 },
  /** Per IP regardless of email — bounds argon2 CPU when an attacker rotates emails. */
  loginPerIp: { limit: 30, windowMs: 15 * 60 * 1000 },
  /** Upload presigning, per organisation. */
  presign: { limit: 60, windowMs: 60 * 1000 },
  /** Document generation, per organisation. */
  generate: { limit: 6, windowMs: 60 * 1000 },
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
  const bucketKey = `${name}:${key}`;
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
  buckets.delete(`${name}:${key}`);
}

/** Drop expired buckets so the map cannot grow without bound. */
export function sweep(now: number = Date.now()): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Test seam only. */
export function clearAll(): void {
  buckets.clear();
}
