import "server-only";

/**
 * `syncOrgBilling` (Phase 16, P1): the only writer of an organization's billing columns.
 *
 * It deliberately ignores which event triggered it. Stripe delivers events twice, late and out of
 * order, so instead of applying "what the event says" it re-reads the customer's subscriptions
 * from Stripe every time. Syncs for one customer run one at a time (`withLock`), so a sync that
 * starts later also writes later and a slow older one can't overwrite a newer result. Throws when
 * Stripe can't be reached, so the webhook answers 500 and Stripe retries.
 *
 * Ported from the reference build's `lib/stripe.ts`; the org, not a user, is the customer (P11).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/src/db";
import { sameStripeMode } from "@/src/db/billing-copy";
import { lockOrg } from "@/src/db/org-lock";
import {
  orgAccountEvents,
  orgBilling,
  organizations,
  type OrgAccountSnapshot,
  type OrgPlan,
  type SubscriptionStatus,
} from "@/src/db/schema";
import { complimentaryState } from "@/src/domain/complimentary";
import { todayIso } from "@/src/domain/dates";
import { billingEnabled } from "@/src/modules/billing/config";
import { withLock } from "@/src/modules/billing/lock";
import {
  isInterval,
  isLive,
  isPlanId,
  END_COMPLIMENTARY_KEY,
  KNOWN_STRIPE_STATUSES,
  pickCurrent,
  type Interval,
} from "@/src/modules/billing/rules";
import { futurePhase, idOf, isMissing, stripe, subscriptionsOf } from "@/src/modules/billing/stripe";

/** Every column the sync writes: the `org_billing` copy, plus `plan` and `subscriptionStatus` on
 *  `organizations`, which are absent when it must not write them (P27). */
export type BillingCopy = {
  stripeStatus: string | null;
  billingInterval: Interval | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pendingPlan: OrgPlan | null;
  pendingInterval: Interval | null;
  pendingAt: Date | null;
  pendingReason: "downgrade" | "price_move" | null;
  upgradePayUrl: string | null;
  upgradeExpiresAt: Date | null;
  collectionPaused: boolean;
  /** The plan a live subscription pays for; undefined when the sync must leave `plan` alone. */
  plan?: OrgPlan;
  /** `subscription_status` as `/a` counts it; undefined when there is nothing to map. */
  subscriptionStatus?: SubscriptionStatus;
};

export type PendingChange = Pick<BillingCopy, "pendingPlan" | "pendingInterval" | "pendingAt" | "pendingReason">;
export type AwaitingPayment = Pick<BillingCopy, "upgradePayUrl" | "upgradeExpiresAt">;

export const NO_PENDING: PendingChange = { pendingPlan: null, pendingInterval: null, pendingAt: null, pendingReason: null };
export const NOT_AWAITING: AwaitingPayment = { upgradePayUrl: null, upgradeExpiresAt: null };

/** §3: Stripe's status as the existing `subscription_status` enum. `incomplete` and `paused`
 *  have no counterpart and leave the column as it is. */
const STATUS_MAP: Partial<Record<string, SubscriptionStatus>> = {
  trialing: "trial",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "cancelled",
  incomplete_expired: "cancelled",
};

/** Every problem worth a person's attention starts with `ALERT` (§5 K6), so one log search finds them. */
export function alert(message: string): void {
  console.error(`[billing] ALERT ${message}`);
}

/** The subscription that counts, with an ALERT when there is more than one live one (U-9). */
export function currentSubscription(customerId: string, subs: readonly Stripe.Subscription[]): Stripe.Subscription | undefined {
  const live = subs.filter((s) => isLive(s.status));
  if (live.length > 1) {
    // Should be impossible: Checkout is locked per org and refuses while one is live or
    // processing. If it happens, a person refunds one; money is never refunded on a guess.
    alert(`customer ${customerId} has ${live.length} live subscriptions: ${live.map((s) => s.id).join(", ")}`);
  }
  return pickCurrent(subs);
}

/**
 * Pure: what the org's columns should say about `sub` (U-7). `previousStatus` is the Stripe status
 * stored now: a dead subscription writes `subscription_status` once, on the way from live to dead,
 * and never `plan` (P27), so a staff grant or a staff edit after it lapsed is never overwritten.
 */
export function copyOf(
  sub: Stripe.Subscription | undefined,
  pending: PendingChange,
  awaiting: AwaitingPayment,
  previousStatus: string | null,
): BillingCopy {
  if (!sub) {
    return {
      stripeStatus: null,
      billingInterval: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      ...NO_PENDING,
      ...NOT_AWAITING,
      collectionPaused: false,
      // The customer (or every subscription) was deleted in Stripe while one was live: that is a
      // cancellation, written once like any live-to-dead move, so `/a` stops saying "Active".
      ...(isLive(previousStatus) ? { subscriptionStatus: "cancelled" as const } : {}),
    };
  }

  if (!(KNOWN_STRIPE_STATUSES as readonly string[]).includes(sub.status)) {
    alert(`subscription ${sub.id} has a status this build doesn't know: "${sub.status}"; treated as not paid`);
  }

  const item = sub.items.data[0]; // this app only ever creates one-price subscriptions
  const metaPlan = item.price.metadata?.plan;
  const plan = isPlanId(metaPlan) ? metaPlan : undefined;
  if (!plan) alert(`subscription ${sub.id} uses price ${item.price.id} with no valid metadata.plan; plan left unchanged`);
  const interval = item.price.recurring?.interval;

  // Cancelling = ends at this period's end. A dashboard cancel_at further ahead still renews first.
  const cancelling = sub.cancel_at_period_end || (sub.cancel_at !== null && sub.cancel_at <= item.current_period_end);
  const live = isLive(sub.status);
  const writeStatus = live || isLive(previousStatus);
  const mappedStatus = STATUS_MAP[sub.status];

  return {
    stripeStatus: sub.status,
    billingInterval: isInterval(interval) ? interval : null,
    // Since API 2025-03-31 the renewal date lives on the item, not the subscription.
    currentPeriodEnd: new Date((cancelling && sub.cancel_at !== null ? sub.cancel_at : item.current_period_end) * 1000),
    cancelAtPeriodEnd: cancelling,
    ...pending,
    ...awaiting,
    collectionPaused: sub.pause_collection !== null && sub.pause_collection !== undefined,
    ...(live && plan ? { plan } : {}),
    ...(writeStatus && mappedStatus ? { subscriptionStatus: mappedStatus } : {}),
  };
}

/** A change queued with a subscription schedule: a downgrade, or a price move (P21). */
async function pendingChange(sub: Stripe.Subscription): Promise<PendingChange> {
  if (!sub.schedule) return NO_PENDING;
  const schedule = await stripe().subscriptionSchedules.retrieve(idOf(sub.schedule), { expand: ["phases.items.price"] });
  const next = futurePhase(schedule);
  const price = next?.items[0]?.price as Stripe.Price | undefined;
  if (!next || !price || price.id === sub.items.data[0].price.id) return NO_PENDING;
  const plan = price.metadata?.plan;
  const interval = price.recurring?.interval;
  if (!isPlanId(plan) || !isInterval(interval)) {
    alert(`schedule ${schedule.id} queues price ${price.id} with no valid metadata.plan or interval`);
    return NO_PENDING;
  }
  return {
    pendingPlan: plan,
    pendingInterval: interval,
    pendingAt: new Date(next.start_date * 1000),
    pendingReason: next.metadata?.reason === "price_move" ? "price_move" : "downgrade",
  };
}

/** An upgrade whose payment was declined or needs 3-D Secure: where to pay it, and until when. */
async function awaitingPayment(sub: Stripe.Subscription): Promise<AwaitingPayment> {
  if (!sub.pending_update || !sub.latest_invoice) return NOT_AWAITING;
  const invoice = await stripe().invoices.retrieve(idOf(sub.latest_invoice));
  if (invoice.status !== "open" || !invoice.hosted_invoice_url) return NOT_AWAITING;
  return {
    upgradePayUrl: invoice.hosted_invoice_url,
    upgradeExpiresAt: new Date(sub.pending_update.expires_at * 1000),
  };
}

/**
 * The org whose customer this is, or undefined. Found only by `stripe_customer_id` (P11), never
 * by event metadata, and a customer stored for the other Stripe mode counts as absent.
 */
export async function findOrgByCustomer(customerId: string): Promise<{ id: string } | undefined> {
  const [org] = await db
    .select({ id: orgBilling.orgId })
    .from(orgBilling)
    .where(and(eq(orgBilling.stripeCustomerId, customerId), sameStripeMode()))
    .limit(1);
  return org;
}

export type SyncOutcome = "synced" | "unknown_customer";

/**
 * Copies the customer's current subscription from Stripe into its org (P1). A customer that
 * belongs to no org here (another business on the same Stripe account, D1) is skipped before
 * any Stripe call.
 */
export function syncOrgBilling(customerId: string): Promise<SyncOutcome> {
  return withLock(`sync:${customerId}`, async () => {
    const org = await findOrgByCustomer(customerId);
    if (!org) return "unknown_customer";

    let subs: Stripe.Subscription[];
    try {
      subs = await subscriptionsOf(customerId);
    } catch (e) {
      if (!isMissing(e)) throw e;
      subs = []; // the customer was deleted in Stripe: nothing is paid for (S-25)
    }
    const sub = currentSubscription(customerId, subs);
    const [pending, awaiting] = sub ? await Promise.all([pendingChange(sub), awaitingPayment(sub)]) : [NO_PENDING, NOT_AWAITING];

    await writeCopy(
      org.id,
      customerId,
      (previousStatus) => copyOf(sub, pending, awaiting, previousStatus),
      endsComplimentaryAt(sub),
      sub?.status === "active",
    );
    return "synced";
  });
}

function snapshot(row: {
  plan: OrgPlan;
  subscriptionStatus: SubscriptionStatus;
  complimentary: boolean;
  complimentaryUntil: string | null;
  suspendedAt: Date | null;
}): OrgAccountSnapshot {
  return {
    plan: row.plan,
    status: row.subscriptionStatus,
    complimentary: row.complimentary,
    complimentaryUntil: row.complimentaryUntil,
    suspended: row.suspendedAt !== null,
  };
}

/**
 * A complimentary org that bought a plan with no deferred start pays today, and its free access
 * ends once that payment has gone through (decided 2026-09-25). Marked on the subscription at
 * Checkout; returns when that subscription was created, or null when it isn't one of those or
 * isn't paid yet. Pure, for U-7's style of test.
 */
export function endsComplimentaryAt(sub: Stripe.Subscription | undefined): Date | null {
  if (!sub || sub.status !== "active" || sub.metadata?.[END_COMPLIMENTARY_KEY] !== "on_payment") return null;
  return new Date(sub.created * 1000);
}

/**
 * Writes the copy under the org row lock (the one staff actions take), and one History row as
 * "Stripe" when the plan or status actually changed (P15, I-6). No Stripe call happens inside the
 * transaction (P12). `endComplimentarySince`: see `endsComplimentaryAt`; only a grant made before
 * that subscription is ended, so a later staff grant is never undone by it.
 */
async function writeCopy(
  orgId: string,
  customerId: string,
  build: (previousStatus: string | null) => BillingCopy,
  endComplimentarySince: Date | null = null,
  /** The subscription is active, so paid: a complimentary grant that has already run out is
   *  cleared (the deferred path's first charge), so staff no longer see a stale Complimentary. */
  paid = false,
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockOrg(tx, orgId, {
      plan: organizations.plan,
      subscriptionStatus: organizations.subscriptionStatus,
      complimentary: organizations.complimentary,
      complimentaryUntil: organizations.complimentaryUntil,
      suspendedAt: organizations.suspendedAt,
    });
    const [billing] = await tx
      .select({ stripeStatus: orgBilling.stripeStatus, stripeCustomerId: orgBilling.stripeCustomerId })
      .from(orgBilling)
      .where(and(eq(orgBilling.orgId, orgId), sameStripeMode()));
    // The customer was replaced between the lookup and the lock: that customer's news is stale.
    if (!row || billing?.stripeCustomerId !== customerId) return;

    const { plan, subscriptionStatus, ...copy } = build(billing.stripeStatus);
    await tx
      .update(orgBilling)
      .set({ ...copy, syncedAt: new Date() })
      .where(eq(orgBilling.orgId, orgId));
    if (plan !== undefined || subscriptionStatus !== undefined) {
      await tx
        .update(organizations)
        .set({ ...(plan ? { plan } : {}), ...(subscriptionStatus ? { subscriptionStatus } : {}) })
        .where(eq(organizations.id, orgId));
    }

    const before = snapshot(row);
    const after = snapshot({
      ...row,
      plan: plan ?? row.plan,
      subscriptionStatus: subscriptionStatus ?? row.subscriptionStatus,
    });
    if (before.plan !== after.plan || before.status !== after.status) {
      await tx.insert(orgAccountEvents).values({
        orgId,
        actorStaffId: null,
        action: "plan_changed",
        before,
        after,
        viaStripe: true,
      });
    }

    const grantRanOut = row.complimentary && complimentaryState(row, todayIso()) === "ended";
    let endGrant = paid && grantRanOut;
    if (!endGrant && endComplimentarySince && row.complimentary) {
      const [lastGrant] = await tx
        .select({ at: orgAccountEvents.createdAt })
        .from(orgAccountEvents)
        .where(
          and(
            eq(orgAccountEvents.orgId, orgId),
            inArray(orgAccountEvents.action, ["complimentary_granted", "complimentary_changed"]),
          ),
        )
        .orderBy(desc(orgAccountEvents.createdAt))
        .limit(1);
      endGrant = !lastGrant || lastGrant.at <= endComplimentarySince;
    }
    if (endGrant) {
      await tx
        .update(organizations)
        .set({ complimentary: false, complimentaryUntil: null, complimentaryPlan: null })
        .where(eq(organizations.id, orgId));
      await tx.insert(orgAccountEvents).values({
        orgId,
        actorStaffId: null,
        action: "complimentary_removed",
        before: after,
        after: { ...after, complimentary: false, complimentaryUntil: null },
        viaStripe: true,
      });
    }
  });
}

// ── Safety nets for a lost webhook (P13) ─────────────────────────────────────

const STALE_EVERY_MS = 5 * 60 * 1000;
/** The Checkout return route re-syncs on every visit, bounded so a reload loop can't hammer Stripe. */
const RETURN_EVERY_MS = 5 * 1000;
const lastAttempt = new Map<string, number>();

/**
 * Re-syncs the org's copy from Stripe. `"stale"`: only when the copy looks overdue (never synced,
 * a period, a queued change or a pending upgrade that should have moved on), at most every 5
 * minutes per org. `"return"`: always, at most every 5 seconds. A Stripe failure keeps the last
 * copy (I-8). Returns whether a sync was attempted.
 */
export async function refreshOrgBilling(orgId: string, mode: "stale" | "return", now: Date = new Date()): Promise<boolean> {
  if (!billingEnabled()) return false;
  const [org] = await db
    .select({
      customerId: orgBilling.stripeCustomerId,
      stripeStatus: orgBilling.stripeStatus,
      currentPeriodEnd: orgBilling.currentPeriodEnd,
      pendingAt: orgBilling.pendingAt,
      upgradeExpiresAt: orgBilling.upgradeExpiresAt,
      syncedAt: orgBilling.syncedAt,
    })
    .from(orgBilling)
    .where(and(eq(orgBilling.orgId, orgId), sameStripeMode()))
    .limit(1);
  if (!org) return false;

  const past = (at: Date | null) => at !== null && at < now;
  const overdue =
    org.syncedAt === null ||
    (isLive(org.stripeStatus) && past(org.currentPeriodEnd)) ||
    past(org.pendingAt) ||
    past(org.upgradeExpiresAt);
  if (mode === "stale" && !overdue) return false;

  const key = `${mode}:${orgId}`;
  const every = mode === "stale" ? STALE_EVERY_MS : RETURN_EVERY_MS;
  if (now.getTime() - (lastAttempt.get(key) ?? 0) < every) return false;
  lastAttempt.set(key, now.getTime());

  try {
    await syncOrgBilling(org.customerId);
  } catch (e) {
    console.error(`[billing] ${mode} re-sync failed for org ${orgId}; showing the last known copy`, e);
  }
  return true;
}

/** Test seam: forget the throttle. */
export function clearRefreshThrottle(): void {
  lastAttempt.clear();
}

// ── Disputes (§2.6, U-9) ─────────────────────────────────────────────────────

/**
 * A card dispute changes no access. It logs ALERT and flags the org for `/a`. Nothing is refunded
 * automatically. A dispute on another business's charge (same Stripe account, D1) is ignored.
 */
export async function flagDispute(dispute: { id: string; charge: string | { id: string } | null }): Promise<SyncOutcome> {
  if (!dispute.charge) return "unknown_customer";
  const charge = await stripe().charges.retrieve(idOf(dispute.charge));
  const customerId = charge.customer ? idOf(charge.customer) : null;
  const org = customerId ? await findOrgByCustomer(customerId) : undefined;
  if (!org) return "unknown_customer";
  alert(`dispute ${dispute.id} on charge ${charge.id} for org ${org.id}; review it in Stripe`);
  await db.update(orgBilling).set({ disputedAt: new Date() }).where(eq(orgBilling.orgId, org.id));
  return "synced";
}
