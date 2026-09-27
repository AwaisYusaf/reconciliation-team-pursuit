/**
 * `npm run billing:reconcile` (Phase 16 P13, the third net for a lost webhook). Re-copies every
 * org's subscription from Stripe, whatever the webhooks did: catches anything missed while the
 * server was down for longer than Stripe's three days of retries. Run nightly from the host
 * crontab (§11 step 9). Exits 1 when any org failed, so the log shows it.
 *
 *   npm run billing:reconcile
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { db } from "@/src/db";
import { sameStripeMode } from "@/src/db/billing-copy";
import { orgBilling } from "@/src/db/schema";
import { billingEnabled } from "@/src/modules/billing/config";
import { syncOrgBilling } from "@/src/modules/billing/sync";

async function main(): Promise<number> {
  if (!billingEnabled()) {
    console.log("[reconcile] billing is off; nothing to do");
    return 0;
  }
  const orgs = await db
    .select({ id: orgBilling.orgId, customerId: orgBilling.stripeCustomerId })
    .from(orgBilling)
    .where(sameStripeMode());

  let failed = 0;
  for (const org of orgs) {
    try {
      await syncOrgBilling(org.customerId);
    } catch (e) {
      failed++;
      console.error(`[reconcile] ALERT org ${org.id} failed to sync`, e);
    }
  }
  console.log(`[reconcile] ${orgs.length - failed}/${orgs.length} organizations synced`);
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("[reconcile] ALERT", error);
    process.exit(1);
  },
);
