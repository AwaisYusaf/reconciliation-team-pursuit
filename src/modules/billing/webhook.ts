/**
 * Stripe webhook handling, framework-free so it is unit-tested without a server (Phase 16 §4.1,
 * U-6). Ported from the reference build's `lib/webhook.ts`. The route
 * (`app/api/stripe/webhook/route.ts`) only reads the body and passes the pieces in.
 */
import Stripe from "stripe";

/**
 * Events that can change what an org has. Anything else is acknowledged and ignored. The live
 * webhook endpoint subscribes to exactly this list (§11 step 4); `billing:listen` forwards it.
 */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.pending_update_applied", // a declined upgrade was paid after all
  "customer.subscription.pending_update_expired", // ...or dropped after 23 hours
  "subscription_schedule.created",
  "subscription_schedule.updated", // a queued downgrade added, changed or dropped
  "subscription_schedule.released",
  "subscription_schedule.completed",
  "subscription_schedule.canceled",
  "subscription_schedule.aborted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
  "charge.dispute.created", // no access change: ALERT and a flag in /a (§2.6)
] as const;

const handled = new Set<string>(HANDLED_EVENTS);
const verifier = new Stripe("sk_test_signature_only"); // constructEvent never calls the API

export type WebhookResponse = { status: number; body: string };

export type WebhookDeps = {
  secret: string;
  /** The configured key's mode: an event from the other mode is refused (P17). */
  live: boolean;
  sync: (customerId: string) => Promise<unknown>;
  dispute: (dispute: { id: string; charge: string | { id: string } | null }) => Promise<unknown>;
};

/**
 * 400 = not from Stripe or the wrong mode (never synced); 500 = our failure, Stripe retries for
 * three days; 200 otherwise, including events for a customer that isn't ours.
 */
export async function handleWebhook(rawBody: string, signature: string | null, deps: WebhookDeps): Promise<WebhookResponse> {
  let event: Stripe.Event;
  try {
    // The signature covers the exact raw bytes: never parse or re-serialise the body before this.
    event = verifier.webhooks.constructEvent(rawBody, signature ?? "", deps.secret);
  } catch {
    return { status: 400, body: "bad signature" };
  }
  // A test-mode event must never touch a live org, or the reverse (e.g. a mixed-up endpoint secret).
  if (event.livemode !== deps.live) return { status: 400, body: "wrong mode" };

  if (!handled.has(event.type)) return { status: 200, body: `ignored ${event.type}` };

  try {
    if (event.type === "charge.dispute.created") {
      await deps.dispute(event.data.object);
      return { status: 200, body: `handled ${event.type}` };
    }

    const { customer } = event.data.object as { customer?: string | { id: string } | null };
    const customerId = typeof customer === "string" ? customer : customer?.id;
    if (!customerId) return { status: 200, body: "ignored: no customer" };
    await deps.sync(customerId);
  } catch (e) {
    console.error(`[billing] webhook ${event.id} (${event.type}) failed; Stripe will retry`, e);
    return { status: 500, body: "sync failed" };
  }
  return { status: 200, body: `synced ${event.type}` };
}
