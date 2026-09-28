import "server-only";

/**
 * Loads what Settings → Plan & billing shows (Phase 16 §4.3), always for the signed-in session's
 * own organization. Re-syncs from Stripe first when our copy looks overdue (the stale safety net,
 * P13), so opening the section repairs a lost webhook; a Stripe failure just shows the last copy.
 */
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/src/db";
import { billingCopyOn } from "@/src/db/billing-copy";
import { orgBilling, organizations, users } from "@/src/db/schema";
import { userDisplay } from "@/src/domain/user-display";
import { billingEnabled } from "@/src/modules/billing/config";
import { planBillingView, type PlanBillingView } from "@/src/modules/billing/plan-view";
import { refreshOrgBilling } from "@/src/modules/billing/sync";
import { listFundingSources } from "@/src/modules/funding-sources/queries";

export type PlanBillingData = {
  view: PlanBillingView;
  isAdmin: boolean;
  /** "Name, Name" of the org's active admins, for a manager's notices. */
  adminNames: string;
  /** The org's active funding sources in the picker's order, for an admin only (`[]` for a
   *  manager). Reconciliation includes one (C8): buying it with several asks which to keep
   *  (D-129), and a switch to it is refused. */
  activeSources: { id: string; name: string }[];
};

/** The org's active admins, as they're shown to a manager ("Your admin (…) can …"). */
export async function activeAdminNames(orgId: string): Promise<string> {
  const admins = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.role, "admin"), isNull(users.deactivatedAt)));
  return admins.map((admin) => userDisplay(admin.name, admin.email)).join(", ");
}

async function loadBillingRow(orgId: string) {
  const [row] = await db
    .select({
      plan: organizations.plan,
      complimentary: organizations.complimentary,
      complimentaryUntil: organizations.complimentaryUntil,
      complimentaryPlan: organizations.complimentaryPlan,
      stripeStatus: orgBilling.stripeStatus,
      billingInterval: orgBilling.billingInterval,
      currentPeriodEnd: orgBilling.currentPeriodEnd,
      cancelAtPeriodEnd: orgBilling.cancelAtPeriodEnd,
      pendingPlan: orgBilling.pendingPlan,
      pendingInterval: orgBilling.pendingInterval,
      pendingAt: orgBilling.pendingAt,
      pendingReason: orgBilling.pendingReason,
      upgradePayUrl: orgBilling.upgradePayUrl,
      upgradeExpiresAt: orgBilling.upgradeExpiresAt,
    })
    .from(organizations)
    .leftJoin(orgBilling, billingCopyOn())
    .where(eq(organizations.id, orgId))
    .limit(1);
  // No copy yet (no Stripe customer) reads as a copy with nothing in it.
  return row && { ...row, cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false };
}

export async function loadPlanBilling(session: { orgId: string; role: string }): Promise<PlanBillingData> {
  await refreshOrgBilling(session.orgId, "stale"); // throttled, never throws

  const row = await loadBillingRow(session.orgId);
  const isAdmin = session.role === "admin";
  const activeSources = isAdmin
    ? (await listFundingSources(session.orgId))
        .filter((source) => source.archivedAt === null)
        .map(({ id, name }) => ({ id, name }))
    : [];

  return {
    view: row ? planBillingView(row, { now: new Date() }) : { kind: "none" },
    isAdmin,
    adminNames: isAdmin ? "" : await activeAdminNames(session.orgId),
    activeSources,
  };
}

/** The one billing banner the app shell shows under the header, if any (Phase 16 §4.5). */
export type BillingBanner =
  | { kind: "paymentFailed"; isAdmin: boolean; adminNames: string }
  | { kind: "upgradeWaiting"; expiresAt: Date }
  | { kind: "compEnding"; until: string };

/**
 * At most one banner, and only when action is needed: a failed payment (everyone, since the
 * app will stop working when Stripe gives up), an upgrade waiting for payment, or complimentary
 * access ending within 14 days (both admin only: only an admin can act on them). Reads the copy
 * as it is: the layout re-syncs an overdue one after the page is sent (the "any page"
 * lost-webhook net, P13), so a slow Stripe never holds up a page.
 */
export async function loadBillingBanner(session: { orgId: string; role: string }): Promise<BillingBanner | null> {
  if (!billingEnabled()) return null;
  const row = await loadBillingRow(session.orgId);
  if (!row) return null;

  const view = planBillingView(row, { now: new Date() });
  const isAdmin = session.role === "admin";
  if (view.kind === "subscribed" && view.paymentFailed) {
    return { kind: "paymentFailed", isAdmin, adminNames: isAdmin ? "" : await activeAdminNames(session.orgId) };
  }
  if (!isAdmin) return null;
  if (view.kind === "subscribed" && view.upgrade) return { kind: "upgradeWaiting", expiresAt: view.upgrade.expiresAt };
  if (view.kind === "complimentaryAccess" && view.endingSoon && view.until) {
    return { kind: "compEnding", until: view.until };
  }
  return null;
}
