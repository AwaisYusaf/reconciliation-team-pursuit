/**
 * `npm run billing:setup` (Phase 15 P20, §11 step 8). Makes Stripe match `pricing.ts`, in
 * whichever mode the key belongs to:
 *  - one Product per plan (`sf360_{plan}`) and one Price per interval, found by lookup key;
 *  - a Price whose amount, currency, interval, product or `metadata.plan` differs from the
 *    constants is replaced: a new Price is created and takes the lookup key over
 *    (`transfer_lookup_key`). The old Price stays active, so existing subscribers keep renewing
 *    on it until `billing:move-subscribers` moves them (P21);
 *  - the Customer Portal configuration: card, invoices and billing details only; switching and
 *    cancelling stay in the app, where the rules live (P14).
 * Safe to re-run: everything is looked up before it is created.
 *
 *   npm run billing:setup              (test key)
 *   npm run billing:setup -- --live    (required with a live key, so live prices are never made by accident)
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { PLAN_LABELS } from "@/src/domain/strings";
import { stripeKeyIsLive } from "@/src/modules/billing/config";
import { lookupKey, PORTAL_TAG, priceCents } from "@/src/modules/billing/pricing";
import { INTERVALS, type PlanId } from "@/src/modules/billing/rules";
import { isMissing, stripe } from "@/src/modules/billing/stripe";

const PLANS: PlanId[] = ["reconciliation", "reconciliation_ai"];
const productId = (plan: PlanId) => `sf360_${plan}`;

async function main() {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!/^(sk|rk)_(test|live)_/.test(key)) throw new Error("Set STRIPE_SECRET_KEY first.");
  const live = stripeKeyIsLive();
  if (live && !process.argv.includes("--live")) {
    throw new Error("This is a LIVE key. Re-run with --live if you mean it.");
  }
  console.log(`Stripe mode: ${live ? "LIVE" : "test"}`);
  const s = stripe();

  for (const plan of PLANS) {
    const product = await s.products.retrieve(productId(plan)).catch(async (e: unknown) => {
      if (!isMissing(e)) throw e;
      return s.products.create({ id: productId(plan), name: PLAN_LABELS[plan], metadata: { plan } });
    });

    for (const interval of INTERVALS) {
      const lookup_key = lookupKey(plan, interval);
      const cents = priceCents(plan, interval);
      const [existing] = (await s.prices.list({ lookup_keys: [lookup_key], limit: 1 })).data;
      const matches =
        existing &&
        existing.active &&
        existing.unit_amount === cents &&
        existing.currency === "usd" &&
        existing.recurring?.interval === interval &&
        existing.recurring.interval_count === 1 &&
        existing.metadata?.plan === plan &&
        existing.product === product.id;
      if (matches) {
        console.log(`ok       ${lookup_key}  ${existing.id}  ${cents} cents/${interval}`);
        continue;
      }
      const price = await s.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: cents,
        recurring: { interval },
        lookup_key,
        transfer_lookup_key: true,
        metadata: { plan }, // the sync and the actions read the plan from here
      });
      console.log(
        `created  ${lookup_key}  ${price.id}  ${cents} cents/${interval}` +
          (existing ? `  (replaces ${existing.id}, ${existing.unit_amount} cents; subscribers stay on it until billing:move-subscribers)` : ""),
      );
    }
  }

  const portals = await s.billingPortal.configurations.list({ active: true, limit: 100 });
  const portal = portals.data.find((c) => c.metadata?.app === PORTAL_TAG);
  if (portal) {
    console.log(`ok       portal configuration  ${portal.id}`);
  } else {
    const created = await s.billingPortal.configurations.create({
      metadata: { app: PORTAL_TAG },
      business_profile: { headline: "Manage your card and invoices" },
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        customer_update: { enabled: true, allowed_updates: ["email", "address", "name"] },
        subscription_cancel: { enabled: false },
        subscription_update: { enabled: false },
      },
    });
    console.log(`created  portal configuration  ${created.id}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
