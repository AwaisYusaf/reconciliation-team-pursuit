/**
 * The only place outside `src/modules/billing/` that turns an organization's billing columns
 * into a yes-or-no access decision (Phase 15 §4.7, U-20). Every reader elsewhere calls
 * `entitlementOf`, `sharesAllowed` or `hasPaidAccess` rather than reading `stripe_status`,
 * `complimentary` or `subscription_status` itself.
 *
 * No `server-only`: nothing here reaches the database directly, and `sharing/public.ts` (which
 * must import no session, `public-isolation.test.ts`) imports this file.
 */
import { organizations } from "@/src/db/schema";
import { todayIso } from "@/src/domain/dates";
import { orgEntitlement, type Entitlement, type EntitlementOrg } from "@/src/modules/billing/entitlement";
import { billingEnabled } from "@/src/modules/billing/config";

/** The billing columns every entitlement decision needs, as a drizzle select map. */
export const ENTITLEMENT_COLUMNS = {
  plan: organizations.plan,
  complimentary: organizations.complimentary,
  complimentaryUntil: organizations.complimentaryUntil,
  complimentaryPlan: organizations.complimentaryPlan,
  stripeStatus: organizations.stripeStatus,
  subscriptionStatus: organizations.subscriptionStatus,
} as const;

export type EntitlementRow = EntitlementOrg & { subscriptionStatus: string };

export function entitlementOf(row: EntitlementOrg): Entitlement {
  return orgEntitlement(row, todayIso(), billingEnabled());
}

/**
 * Whether a shared link may open for this organization.
 *
 * While billing is off, this keeps today's hand-set rule exactly (AC-F5): a "cancelled"
 * `subscription_status` still stops shared links, independent of the entitlement (which is
 * always paid while billing is off). Once billing is on, the entitlement alone decides — a
 * subscription's Stripe status already governs `subscription_status` (P27), so there is nothing
 * left for the old column to add.
 */
export function sharesAllowed(row: EntitlementRow): boolean {
  const ent = entitlementOf(row);
  return ent.reason === "billing_off" ? row.subscriptionStatus !== "cancelled" : ent.paid;
}

/**
 * Whether a session has paid access. Fails closed: while billing is on, a `SessionContext` built
 * without an `entitlement` (most test fixtures) is treated as unpaid rather than assumed paid.
 */
export function hasPaidAccess(session: { entitlement?: Entitlement }): boolean {
  return session.entitlement ? session.entitlement.paid : !billingEnabled();
}

/**
 * The date a complimentary grant ended, for `/r/plan`'s headline (`billingCompEnded`). Reading
 * the column here, rather than in the page, keeps every other reader off it (U-20).
 */
export function complimentaryEndedOn(row: Pick<EntitlementOrg, "complimentaryUntil">): string | null {
  return row.complimentaryUntil;
}
