/**
 * `npm run billing:move-subscribers` (Phase 16 P21, O4, §11 step 8). Moves subscribers whose
 * price no longer matches `pricing.ts` onto the active price, at their next renewal, via a
 * subscription schedule phase tagged `metadata.reason=price_move`. A queued downgrade is
 * rewritten in place, kept as a downgrade. Dry run by default; nothing in Stripe changes
 * without `--apply`.
 *
 *   npm run billing:move-subscribers                    (dry run, test key)
 *   npm run billing:move-subscribers -- --apply          (test key)
 *   npm run billing:move-subscribers -- --live --apply   (required for a live key)
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { planPriceMoves } from "@/src/modules/billing/billing";
import { billingEnabled, stripeKeyIsLive } from "@/src/modules/billing/config";

async function main(): Promise<void> {
  if (!billingEnabled()) throw new Error('BILLING_ENABLED is not "true"; nothing to move.');
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!/^(sk|rk)_(test|live)_/.test(key)) throw new Error("Set STRIPE_SECRET_KEY first.");
  const live = stripeKeyIsLive();
  if (live && !process.argv.includes("--live")) {
    throw new Error("This is a LIVE key. Re-run with --live if you mean it.");
  }
  const apply = process.argv.includes("--apply");
  console.log(`Stripe mode: ${live ? "LIVE" : "test"}; ${apply ? "APPLYING" : "dry run"}`);

  const { moved, skipped } = await planPriceMoves({ apply });

  console.log(`\n${apply ? "moved" : "would move"} (${moved.length}):`);
  for (const m of moved) console.log(`  org ${m.orgId}  ${m.fromPriceId} -> ${m.toPriceId}  from ${m.effectiveAt}`);

  console.log(`\nskipped (${skipped.length}):`);
  for (const s of skipped) console.log(`  org ${s.orgId}  ${s.reason}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
