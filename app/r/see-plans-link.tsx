import Link from "next/link";

import { UI } from "@/src/domain/strings";
import { billingEnabled } from "@/src/modules/billing/config";

/**
 * "See plans", beside the "…part of the Reconciliation + AI plan." notes (Phase 16 C5, Q4): the
 * way a base-plan admin finds the upgrade, since base-plan orgs have no Plus pill (PHASE-11 fix
 * #12). A separate element, never inside `UI.summaryPlanNote`, which is also a server refusal and
 * a 403 body. Admins only, and only once billing is on: before that there is nothing to choose.
 */
export function SeePlansLink({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin || !billingEnabled()) return null;
  return (
    <Link href="/r/settings?section=plan" className="text-[15px] text-accent underline hover:text-accent-dark">
      {UI.billingSeePlans}
    </Link>
  );
}
