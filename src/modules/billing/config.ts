/**
 * Billing gating (Phase 15, P25) and startup validation. Pure — no `server-only` import,
 * unlike `src/modules/auth/config.ts`'s `signupEnabled`: `instrumentation.ts` runs before any
 * request and needs to call `billingConfigProblems` from outside the `react-server` condition.
 */

/** Pinned API version (P26): the SDK client and the webhook endpoint must both use this. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

/**
 * Billing gating (D-15's sibling for Stripe). Off by default; everyone keeps today's access
 * until Phase 8 turns it on (P25).
 */
export function billingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}

const STRIPE_SECRET_KEY_RE = /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/;

/**
 * Every problem with the billing environment, collected at once rather than reported one at a
 * time (P25). Returns `[]` when billing is off — a deployment with no Stripe keys at all must
 * still boot. Messages name the variable only, never its value: this runs from
 * `instrumentation.ts` and a bad key must never end up in a boot log.
 */
export function billingConfigProblems(env: Record<string, string | undefined>): string[] {
  if (env.BILLING_ENABLED !== "true") return [];

  const problems: string[] = [];

  const stripeKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const live = stripeKey.startsWith("sk_live_") || stripeKey.startsWith("rk_live_");
  if (!STRIPE_SECRET_KEY_RE.test(stripeKey)) {
    problems.push("STRIPE_SECRET_KEY must be a Stripe secret key (sk_test_..., sk_live_..., or a restricted rk_ key)");
  }

  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  if (!webhookSecret.startsWith("whsec_") || webhookSecret === "whsec_") {
    problems.push("STRIPE_WEBHOOK_SECRET must start with whsec_ and have a value after it");
  }

  // Live money over plain http would leak session cookies; refuse rather than warn (P25, U-5).
  if (live) {
    const appUrl = env.APP_URL?.trim() ?? "";
    let url: URL | undefined;
    try {
      url = new URL(appUrl);
    } catch {
      problems.push("APP_URL must be a full URL like https://app.example.com when using a live Stripe key");
    }
    if (url && url.protocol !== "https:") {
      problems.push("APP_URL must be https:// when using a live Stripe key");
    }
  }

  return problems;
}
