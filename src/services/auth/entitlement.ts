/**
 * The only place outside `src/modules/billing/` that turns an organization's billing columns
 * into a yes-or-no access decision (Phase 16 §4.7, U-20). Every reader elsewhere calls
 * `entitlementOf`, `sharesAllowed` or `hasPaidAccess` rather than reading `stripe_status`,
 * `complimentary` or `subscription_status` itself.
 *
 * No `server-only`: nothing here reaches the database directly, and `sharing/public.ts` (which
 * must import no session, `public-isolation.test.ts`) imports this file.
 */
import { orgBilling, organizations } from "@/src/db/schema";
import { todayIso, type IsoDate } from "@/src/domain/dates";
import {
  orgEntitlement,
  reconciliationStartsOn,
  type Entitlement,
  type EntitlementOrg,
  type UpcomingPlanOrg,
} from "@/src/modules/billing/entitlement";
import { billingEnabled } from "@/src/modules/billing/config";

/** The org's own columns every entitlement decision needs, as a drizzle select map. */
export const ORG_ENTITLEMENT_COLUMNS = {
  plan: organizations.plan,
  complimentary: organizations.complimentary,
  complimentaryUntil: organizations.complimentaryUntil,
  complimentaryPlan: organizations.complimentaryPlan,
  subscriptionStatus: organizations.subscriptionStatus,
} as const;

/**
 * Every column an entitlement decision needs, as a drizzle select map. `stripeStatus` comes from
 * `org_billing`, so a query selecting these must also
 * `.leftJoin(orgBilling, billingCopyOn())` (`src/db/billing-copy.ts`); an org with no Stripe
 * customer, or one from the other Stripe mode, then reads `stripeStatus: null` (D-125).
 */
export const ENTITLEMENT_COLUMNS = {
  ...ORG_ENTITLEMENT_COLUMNS,
  stripeStatus: orgBilling.stripeStatus,
} as const;

export type EntitlementRow = EntitlementOrg & { subscriptionStatus: string };

/** A row with no `stripeStatus` (a new org, before any Stripe customer) is one with none. */
export function entitlementOf(row: Omit<EntitlementOrg, "stripeStatus"> & { stripeStatus?: string | null }): Entitlement {
  return orgEntitlement({ ...row, stripeStatus: row.stripeStatus ?? null }, todayIso(), billingEnabled());
}

/** `reconciliationStartsOn` for a row read with the `pending_*` copy. */
export function reconciliationStartsOf(row: UpcomingPlanOrg): IsoDate | null {
  return reconciliationStartsOn(row, new Date());
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
