import { readCappedText } from "@/src/lib/json-request";
import { billingEnabled, stripeKeyIsLive } from "@/src/modules/billing/config";
import { flagDispute, syncOrgBilling } from "@/src/modules/billing/sync";
import { handleWebhook } from "@/src/modules/billing/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stripe's events are a few KB; 1 MB holds any real one with room to spare. */
const MAX_BODY_BYTES = 1_000_000;

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/**
 * `POST /api/stripe/webhook` (Phase 16 §4.1). Called by Stripe, so no session and no origin
 * check: `readJsonBody`'s same-origin check would refuse every event. The signature is the
 * authentication, and it covers the raw bytes, so the body is read as text and never parsed
 * before it is verified. Not rate limited: Stripe's retries must always get through.
 *
 * 503 while billing is off (P25): Stripe keeps retrying for three days, so switching billing on
 * again catches up on what it missed.
 */
export async function POST(request: Request) {
  if (!billingEnabled()) return text(503, "billing is off");

  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return text(500, "not configured"); // the startup check makes this unreachable

  const body = await readCappedText(request, MAX_BODY_BYTES);
  if (body === null) return text(413, "too large");

  const result = await handleWebhook(body, request.headers.get("stripe-signature"), {
    secret,
    live: stripeKeyIsLive(),
    sync: syncOrgBilling,
    dispute: flagDispute,
  });
  return text(result.status, result.body);
}
