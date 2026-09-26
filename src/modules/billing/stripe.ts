import "server-only";

/**
 * The Stripe client and the small Stripe-shaped helpers the sync and the actions share (Phase 16
 * §4.1, ported from the reference build's `lib/stripe.ts`).
 *
 * The client is built on first use, never at import: with `BILLING_ENABLED` off the app starts
 * and runs without any Stripe key (P25), and every path that reaches here is behind that switch.
 */
import Stripe from "stripe";

import { STRIPE_API_VERSION } from "@/src/modules/billing/config";

let client: Stripe | undefined;

/** Longest wait for one Stripe request; the SDK's default is 80 s. A sync that waits on Stripe
 *  keeps a Settings page, the Checkout return or a webhook waiting with it. */
const STRIPE_TIMEOUT_MS = 10_000;

/** Pinned SDK and API version (P26); the key is trimmed exactly as the startup check trims it. */
export function stripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client = new Stripe(key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: STRIPE_TIMEOUT_MS });
  return client;
}

export const isMissing = (e: unknown): boolean =>
  e instanceof Stripe.errors.StripeInvalidRequestError && e.code === "resource_missing";

export const idOf = (x: string | { id: string }): string => (typeof x === "string" ? x : x.id);

/** Every subscription the customer has had. A deleted customer still lists its cancelled ones. */
export async function subscriptionsOf(customerId: string): Promise<Stripe.Subscription[]> {
  return (await stripe().subscriptions.list({ customer: customerId, status: "all", limit: 20 })).data;
}

/** The phase after the current one: a change queued for the period end. None once it has happened. */
export function futurePhase(schedule: Stripe.SubscriptionSchedule): Stripe.SubscriptionSchedule.Phase | undefined {
  const current = schedule.current_phase;
  return current ? schedule.phases.find((p) => p.start_date >= current.end_date) : undefined;
}

/** "Now" as Stripe sees it for this customer: a test clock's frozen time in tests, real time otherwise. */
export async function stripeNow(customerId: string): Promise<number> {
  const customer = await stripe().customers.retrieve(customerId, { expand: ["test_clock"] });
  const clock = "test_clock" in customer ? (customer.test_clock as Stripe.TestHelpers.TestClock | null) : null;
  return clock?.frozen_time ?? Math.floor(Date.now() / 1000);
}
