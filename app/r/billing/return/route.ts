import { redirect } from "next/navigation";

import { SETTINGS_PLAN_PATH } from "@/src/modules/billing/billing";
import { refreshOrgBilling } from "@/src/modules/billing/sync";
import { getSession } from "@/src/services/auth/session";

export const dynamic = "force-dynamic";

/**
 * `GET /r/billing/return` (Phase 16 §4.1): where Stripe sends the admin back after Checkout.
 * Every query parameter is ignored — nothing from the URL is trusted. Safety net for a lost
 * webhook: re-syncs this org's own customer right now instead of waiting (`refreshOrgBilling`
 * is throttled and never throws). Read-only: the session is never modified here.
 *
 * A not-yet-onboarded org goes on to onboarding's first step with the payment note (usability
 * #9). The `paid=1` it adds is a display hint only; nothing trusts it.
 */
export async function GET() {
  const session = await getSession();
  if (!session) redirect("/login");

  await refreshOrgBilling(session.orgId, "return");
  redirect(session.onboarded ? SETTINGS_PLAN_PATH : "/onboarding/funding?paid=1");
}
