import "server-only";

/**
 * Every billing action that moves money or changes a subscription (Phase 15 §4.1, ported from
 * the reference build's `lib/billing.ts`, keyed by organization instead of user).
 *
 * Rules every exported function follows:
 *  1. Decide from Stripe's live state, never from our copy (which may be a webhook behind).
 *  2. Re-derive the change server-side; nothing from a form is trusted beyond "which plan/interval".
 *  3. Complimentary orgs never touch Stripe while complimentary (P10) — checked before any call.
 *  4. Mutating functions run one at a time per org (`withLock`), so a double-click can't double-act.
 *  5. After Stripe has changed, best-effort refresh our copy and the Stripe customer's email, but
 *     never fail the action because of either: the money already moved.
 */
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/src/db";
import { fundingSources, organizations } from "@/src/db/schema";
import { isComplimentaryNow } from "@/src/domain/complimentary";
import { todayIso, type IsoDate } from "@/src/domain/dates";
import { siteOrigin } from "@/src/lib/site-url";
import { billingEnabled, stripeKeyIsLive } from "@/src/modules/billing/config";
import { withLock } from "@/src/modules/billing/lock";
import { lookupKey, PORTAL_TAG } from "@/src/modules/billing/pricing";
import {
  changeBlockedReason,
  classifyChange,
  isInterval,
  isLive,
  isPlanId,
  pickCurrent,
  type Change,
  type Interval,
  type PlanId,
} from "@/src/modules/billing/rules";
import { futurePhase, idOf, stripe, subscriptionsOf, stripeNow } from "@/src/modules/billing/stripe";
import { syncOrgBilling } from "@/src/modules/billing/sync";

export type Actor = { orgId: string; email: string };

export type BillingErrorCode =
  | "unknown_plan"
  | "price_missing"
  | "already_subscribed"
  | "payment_processing"
  | "no_plan"
  | "payment_failed"
  | "payment_pending"
  | "cancel_pending"
  | "change_pending"
  | "same_plan"
  | "quote_expired"
  | "portal_not_setup"
  | "complimentary"
  | "too_many_sources";

export class BillingError extends Error {
  readonly code: BillingErrorCode;
  /** Set only for `too_many_sources`: the active funding-source count (P24). */
  readonly count?: number;
  constructor(code: BillingErrorCode, count?: number) {
    super(code);
    this.code = code;
    this.count = count;
  }
}

// ── Fixed paths (one place, per the plan) ────────────────────────────────────

export const BILLING_RETURN_PATH = "/r/billing/return";
export const PLAN_CANCELLED_PATH = "/r/plan?checkout=cancelled";
export const SETTINGS_PLAN_PATH = "/r/settings?section=plan";

// ── The org row ──────────────────────────────────────────────────────────────

type OrgRow = {
  id: string;
  name: string;
  stripeCustomerId: string | null;
  stripeLivemode: boolean | null;
  complimentary: boolean;
  complimentaryUntil: IsoDate | null;
};

async function loadOrg(orgId: string): Promise<OrgRow> {
  const [row] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      stripeCustomerId: organizations.stripeCustomerId,
      stripeLivemode: organizations.stripeLivemode,
      complimentary: organizations.complimentary,
      complimentaryUntil: organizations.complimentaryUntil,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  // Unreachable in practice: the caller's session already proved the org exists.
  if (!row) throw new Error(`org ${orgId} not found`);
  return row;
}

/** Active (not archived) funding sources for the org (P24): the one-source limit on Reconciliation. */
async function activeFundingSourceCount(orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(fundingSources)
    .where(and(eq(fundingSources.orgId, orgId), isNull(fundingSources.archivedAt)));
  return row?.total ?? 0;
}

/** A customer id stored for the other Stripe mode counts as absent (P11). */
function liveCustomerId(row: OrgRow): string | null {
  if (!row.stripeCustomerId) return null;
  return row.stripeLivemode === stripeKeyIsLive() ? row.stripeCustomerId : null;
}

function assertNotComplimentary(row: Pick<OrgRow, "complimentary" | "complimentaryUntil">): void {
  if (isComplimentaryNow(row, todayIso())) throw new BillingError("complimentary");
}

// ── Helpers shared by several actions ─────────────────────────────────────────

const orgLock = <T>(orgId: string, fn: () => Promise<T>) => withLock(`org:${orgId}`, fn);

export async function findPrice(plan: unknown, interval: unknown): Promise<Stripe.Price> {
  if (!isPlanId(plan) || !isInterval(interval)) throw new BillingError("unknown_plan");
  const { data } = await stripe().prices.list({ lookup_keys: [lookupKey(plan, interval)], active: true });
  if (!data[0]) throw new BillingError("price_missing");
  return data[0];
}

function planOf(price: Stripe.Price): { plan: PlanId; interval: Interval } {
  const plan = price.metadata.plan;
  const interval = price.recurring?.interval;
  if (!isPlanId(plan) || !isInterval(interval)) throw new BillingError("unknown_plan");
  return { plan, interval };
}

/** Every URL handed to the client must actually be Stripe's (U-11): https, host ending .stripe.com. */
function assertStripeUrl(url: string | null | undefined): string {
  if (!url) throw new Error("Stripe returned no URL");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Stripe returned an unusable URL: ${url}`);
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".stripe.com")) {
    throw new Error(`Stripe returned an unexpected URL: ${url}`);
  }
  return url;
}

/** Best-effort: never fails the action, the webhook (or the next stale re-sync) will catch up. */
async function refresh(customerId: string): Promise<void> {
  try {
    await syncOrgBilling(customerId);
  } catch (e) {
    console.error(`[billing] refresh after a change failed for ${customerId}; the webhook will catch up`, e);
  }
}

/** Best-effort: the Stripe customer's email follows the acting admin (I-17). */
async function syncEmail(actor: Actor, customerId: string): Promise<void> {
  try {
    await stripe().customers.update(customerId, { email: actor.email });
  } catch (e) {
    console.error(`[billing] updating the Stripe customer's email failed for ${customerId}`, e);
  }
}

async function ensureCustomer(actor: Actor, row: OrgRow): Promise<string> {
  const existing = liveCustomerId(row);
  if (existing) return existing;

  // No hand-made idempotency key (P11): one built from the org id would collide across
  // databases sharing a Stripe account (D1). The SDK's own automatic retries are already
  // idempotent, and the org lock stops a double-click from racing itself.
  const customer = await stripe().customers.create({
    email: actor.email,
    name: row.name,
    metadata: { orgId: row.id },
  });
  const live = stripeKeyIsLive();

  const updated = await db
    .update(organizations)
    .set({ stripeCustomerId: customer.id, stripeLivemode: live })
    .where(
      and(
        eq(organizations.id, row.id),
        sql`(${organizations.stripeCustomerId} IS NULL OR ${organizations.stripeLivemode} IS DISTINCT FROM ${live})`,
      ),
    )
    .returning({ stripeCustomerId: organizations.stripeCustomerId });
  if (updated[0]) return customer.id;

  // Lost the race: someone else already stored a customer id under the lock. Use theirs.
  const fresh = await loadOrg(row.id);
  return liveCustomerId(fresh) ?? customer.id;
}

/** The subscription an action may change: exists, from Stripe (not our copy), with its schedule
 *  and any queued future phase, tagged with whether that queued phase is a price move (P21). */
async function changeableSubscription(customerId: string): Promise<{
  sub: Stripe.Subscription;
  customerId: string;
  item: Stripe.SubscriptionItem;
  schedule: Stripe.SubscriptionSchedule | null;
  queued: Stripe.SubscriptionSchedule.Phase | undefined;
  queuedIsPriceMove: boolean;
}> {
  const sub = pickCurrent(await subscriptionsOf(customerId));
  const blocked = changeBlockedReason({
    status: sub?.status ?? null,
    cancel_at_period_end: !!sub && (sub.cancel_at_period_end || sub.cancel_at !== null),
  });
  if (blocked) throw new BillingError(blocked);
  if (sub!.pending_update) throw new BillingError("payment_pending");
  const schedule = sub!.schedule
    ? await stripe().subscriptionSchedules.retrieve(idOf(sub!.schedule), { expand: ["phases.items.price"] })
    : null;
  const queued = schedule ? futurePhase(schedule) : undefined;
  return {
    sub: sub!,
    customerId,
    item: sub!.items.data[0],
    schedule,
    queued,
    queuedIsPriceMove: queued?.metadata?.reason === "price_move",
  };
}

/** Rewrites (or creates) a schedule's phases: the current phase exactly as Stripe has it, and a
 *  new future phase on `targetPrice`. Shared by a queued downgrade (`billing_cycle_anchor:
 *  "phase_start"`, so the new plan bills in full the day it starts) and a queued price move
 *  (no anchor change — the phase already sits at the period boundary). */
async function createOrExtendSchedule(
  sub: Stripe.Subscription,
  item: { quantity?: number | null },
  targetPrice: Stripe.Price,
  existing: Stripe.SubscriptionSchedule | null,
  reason: "downgrade" | "price_move",
): Promise<void> {
  const schedule = existing ?? (await stripe().subscriptionSchedules.create({ from_subscription: sub.id }));
  const current = schedule.current_phase;
  const currentPhase = current && schedule.phases.find((p) => p.start_date === current.start_date);
  if (!current || !currentPhase) throw new Error(`Schedule ${schedule.id} has no current phase`);

  await stripe().subscriptionSchedules.update(schedule.id, {
    end_behavior: "release", // after the switch, the subscription carries on by itself
    proration_behavior: "none", // rewriting the schedule must never create a charge or credit
    phases: [
      {
        items: currentPhase.items.map((i) => ({ price: idOf(i.price), quantity: i.quantity ?? 1 })),
        start_date: current.start_date,
        end_date: current.end_date,
      },
      {
        items: [{ price: targetPrice.id, quantity: item.quantity ?? 1 }],
        duration: { interval: targetPrice.recurring!.interval, interval_count: 1 },
        proration_behavior: "none",
        ...(reason === "downgrade" ? { billing_cycle_anchor: "phase_start" as const } : {}),
        ...(reason === "price_move" ? { metadata: { reason: "price_move" } } : {}),
      },
    ],
  });
}

/** Rewrites an EXISTING schedule's future phase to a different price, keeping its start date and
 *  `reason` (P21's cancelPendingChange rewrite, and move-subscribers rewriting a queued downgrade). */
async function retagFuturePhase(
  schedule: Stripe.SubscriptionSchedule,
  targetPrice: Stripe.Price,
  reason: "downgrade" | "price_move",
): Promise<void> {
  const current = schedule.current_phase;
  const currentPhase = current && schedule.phases.find((p) => p.start_date === current.start_date);
  const future = futurePhase(schedule);
  if (!current || !currentPhase || !future) throw new Error(`Schedule ${schedule.id} has no phases to rewrite`);

  await stripe().subscriptionSchedules.update(schedule.id, {
    end_behavior: schedule.end_behavior,
    proration_behavior: "none",
    phases: [
      {
        items: currentPhase.items.map((i) => ({ price: idOf(i.price), quantity: i.quantity ?? 1 })),
        start_date: currentPhase.start_date,
        end_date: currentPhase.end_date,
      },
      {
        items: [{ price: targetPrice.id, quantity: future.items[0]?.quantity ?? 1 }],
        start_date: future.start_date,
        duration: { interval: targetPrice.recurring!.interval, interval_count: 1 },
        proration_behavior: "none",
        ...(reason === "price_move" ? { metadata: { reason: "price_move" } } : {}),
      },
    ],
  });
}

/** The active price for a plan/interval, found from an existing Stripe price's own metadata. */
async function activePriceFor(price: Stripe.Price): Promise<Stripe.Price> {
  const { plan, interval } = planOf(price);
  return findPrice(plan, interval);
}

// ── New subscription ─────────────────────────────────────────────────────────

/** Returns the Stripe Checkout URL to send the admin to. Access is granted by the webhook /
 *  return sync, never here. */
export function startCheckout(actor: Actor, plan: unknown, interval: unknown): Promise<string> {
  return orgLock(actor.orgId, async () => {
    const row = await loadOrg(actor.orgId);
    assertNotComplimentary(row);
    if (!isPlanId(plan) || !isInterval(interval)) throw new BillingError("unknown_plan");
    // Reconciliation allows one active funding source (C8, P24) — refused before any Stripe call.
    if (plan === "reconciliation") {
      const n = await activeFundingSourceCount(actor.orgId);
      if (n > 1) throw new BillingError("too_many_sources", n);
    }
    const price = await findPrice(plan, interval);
    const customerId = await ensureCustomer(actor, row);
    await syncEmail(actor, customerId);

    const subs = await subscriptionsOf(customerId);
    if (subs.some((s) => isLive(s.status))) {
      await refresh(customerId); // our copy was behind; fix it
      throw new BillingError("already_subscribed");
    }
    // Checkout only creates a subscription once paid, so "incomplete" here means a payment still
    // clearing. A second Checkout now could end in two subscriptions.
    if (subs.some((s) => s.status === "incomplete")) throw new BillingError("payment_processing");

    // Only one open Checkout per org: an older tab can no longer be paid. If that older one was
    // completed a moment ago, expire() fails and nothing new is created.
    const open = await stripe().checkout.sessions.list({ customer: customerId, status: "open", limit: 10 });
    for (const s of open.data) await stripe().checkout.sessions.expire(s.id);

    const origin = siteOrigin();
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      payment_method_types: ["card"],
      client_reference_id: actor.orgId,
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: { metadata: { orgId: actor.orgId } },
      success_url: `${origin}${BILLING_RETURN_PATH}`,
      cancel_url: `${origin}${PLAN_CANCELLED_PATH}`,
    });
    return assertStripeUrl(session.url);
  });
}

// ── Switching plan ───────────────────────────────────────────────────────────

export type ChangeQuote = {
  change: Exclude<Change, "none">;
  from: { plan: PlanId; interval: Interval };
  to: { plan: PlanId; interval: Interval };
  dueTodayCents: number; // what the card is charged now (0 for a change at period end)
  recurringCents: number; // the new plan's price per interval
  currency: string;
  effectiveAt: number; // ms: when the new plan starts
  nextChargeAt: number; // ms: when the new recurring price is first charged
  prorationDate: number; // pinned so the charge equals this quote exactly
};

const QUOTE_VALID_SECONDS = 15 * 60;

/** What a switch would do and cost, computed by Stripe. Changes nothing. No lock: nothing to
 *  serialise against. */
export async function quoteChange(actor: Actor, plan: unknown, interval: unknown): Promise<ChangeQuote> {
  const row = await loadOrg(actor.orgId);
  assertNotComplimentary(row);
  const customerId = liveCustomerId(row);
  if (!customerId) throw new BillingError("no_plan");

  const target = await findPrice(plan, interval);
  const { sub, item, queued, queuedIsPriceMove } = await changeableSubscription(customerId);
  const from = planOf(item.price);
  const to = planOf(target);
  const change = classifyChange(from, to);
  if (change === "none") throw new BillingError("same_plan");
  // A downgrade to Reconciliation is refused while more than one source is active (C8, P24).
  if (to.plan === "reconciliation" && from.plan !== "reconciliation") {
    const n = await activeFundingSourceCount(actor.orgId);
    if (n > 1) throw new BillingError("too_many_sources", n);
  }

  const base = { from, to, recurringCents: target.unit_amount ?? 0, currency: target.currency };
  if (change === "at_period_end") {
    const at = item.current_period_end * 1000;
    return { ...base, change, dueTodayCents: 0, effectiveAt: at, nextChargeAt: at, prorationDate: 0 };
  }
  // An upgrade while a downgrade is queued would have to drop it; make the admin do that
  // explicitly. A queued price move is not a downgrade and doesn't block an upgrade (P21).
  if (queued && !queuedIsPriceMove) throw new BillingError("change_pending");

  const prorationDate = await stripeNow(customerId);
  const preview = await stripe().invoices.createPreview({
    customer: customerId,
    subscription: sub.id,
    subscription_details: {
      items: [{ id: item.id, price: target.id }],
      proration_behavior: "always_invoice",
      proration_date: prorationDate,
    },
  });
  return {
    ...base,
    change,
    dueTodayCents: preview.amount_due,
    effectiveAt: prorationDate * 1000,
    nextChargeAt: Math.max(...preview.lines.data.map((l) => l.period.end)) * 1000,
    prorationDate,
  };
}

export type ChangeResult =
  | { result: "changed" }
  | { result: "scheduled" }
  | { result: "payment_needed"; payUrl: string | null };

/**
 * Apply a switch the admin confirmed on the quote screen.
 * - "now": charge the prorated difference immediately; the plan changes ONLY if that payment
 *   succeeds (`pending_if_incomplete`). Declined or needs 3-D Secure: the old plan stays and the
 *   admin is sent to Stripe's hosted invoice page.
 * - "at_period_end": queue it on a subscription schedule; nothing is charged today.
 */
export function applyChange(actor: Actor, plan: unknown, interval: unknown, prorationDate: number): Promise<ChangeResult> {
  return orgLock(actor.orgId, async () => {
    const row = await loadOrg(actor.orgId);
    assertNotComplimentary(row);
    const customerId = liveCustomerId(row);
    if (!customerId) throw new BillingError("no_plan");
    await syncEmail(actor, customerId);

    const target = await findPrice(plan, interval);
    const { sub, item, schedule, queued, queuedIsPriceMove } = await changeableSubscription(customerId);
    const from = planOf(item.price);
    const to = planOf(target);
    const change = classifyChange(from, to);
    if (change === "none") throw new BillingError("same_plan");
    // A downgrade to Reconciliation is refused while more than one source is active (C8, P24),
    // before anything is created in Stripe.
    if (to.plan === "reconciliation" && from.plan !== "reconciliation") {
      const n = await activeFundingSourceCount(actor.orgId);
      if (n > 1) throw new BillingError("too_many_sources", n);
    }

    if (change === "at_period_end") {
      await createOrExtendSchedule(sub, item, target, schedule, "downgrade");
      await refresh(customerId);
      return { result: "scheduled" };
    }

    if (queued && !queuedIsPriceMove) throw new BillingError("change_pending");
    // The price shown must be the price charged: only accept a recent, non-future quote.
    const now = await stripeNow(customerId);
    if (!Number.isInteger(prorationDate) || prorationDate > now || now - prorationDate > QUOTE_VALID_SECONDS) {
      throw new BillingError("quote_expired");
    }
    // A schedule left over from a downgrade that already happened, or one queuing a price move
    // (P21), is released: a subscription attached to a schedule can't have its items updated.
    if (schedule) await stripe().subscriptionSchedules.release(schedule.id);

    const updated = await stripe().subscriptions.update(
      sub.id,
      {
        items: [{ id: item.id, price: target.id }],
        proration_behavior: "always_invoice",
        proration_date: prorationDate,
        payment_behavior: "pending_if_incomplete",
        expand: ["latest_invoice"],
      },
      { idempotencyKey: `change-${sub.id}-${target.id}-${prorationDate}` },
    );
    await refresh(customerId);

    if (updated.pending_update) {
      const invoice = updated.latest_invoice as Stripe.Invoice | null;
      const payUrl = invoice?.hosted_invoice_url ?? null;
      return { result: "payment_needed", payUrl: payUrl ? assertStripeUrl(payUrl) : null };
    }
    return { result: "changed" };
  });
}

/** Drop a queued downgrade; the subscription renews on its current plan. Keeps a queued price
 *  move if the current price is still active, otherwise rewrites it to tag the price move (P21):
 *  the current subscription's price may itself have moved since the change was queued. */
export function cancelPendingChange(actor: Actor): Promise<void> {
  return orgLock(actor.orgId, async () => {
    const row = await loadOrg(actor.orgId);
    assertNotComplimentary(row);
    const customerId = liveCustomerId(row);
    if (!customerId) throw new BillingError("no_plan");
    await syncEmail(actor, customerId);

    const sub = pickCurrent(await subscriptionsOf(customerId));
    if (sub?.schedule) {
      const scheduleId = idOf(sub.schedule);
      const currentPrice = sub.items.data[0].price;
      const activePrice = await activePriceFor(currentPrice);
      if (currentPrice.id !== activePrice.id) {
        const schedule = await stripe().subscriptionSchedules.retrieve(scheduleId, { expand: ["phases.items.price"] });
        await retagFuturePhase(schedule, activePrice, "price_move");
      } else {
        await stripe().subscriptionSchedules.release(scheduleId);
      }
    }
    await refresh(customerId);
  });
}

// ── Cancel / resume ──────────────────────────────────────────────────────────

/** Cancel at the end of the paid period. Access continues until then; a queued downgrade (or
 *  price move) is dropped. */
export function cancelAtPeriodEnd(actor: Actor): Promise<void> {
  return orgLock(actor.orgId, async () => {
    const row = await loadOrg(actor.orgId);
    assertNotComplimentary(row);
    const customerId = liveCustomerId(row);
    if (!customerId) throw new BillingError("no_plan");
    await syncEmail(actor, customerId);

    const { sub, schedule } = await changeableSubscription(customerId); // refuses if already cancelling
    if (schedule) await stripe().subscriptionSchedules.release(schedule.id);
    await stripe().subscriptions.update(sub.id, { cancel_at_period_end: true });
    await refresh(customerId);
  });
}

/**
 * The renewal payment failed (C2). The current period was never paid for, so it ends now, and
 * the unpaid invoice is voided: a card that starts working later is never charged for a plan
 * the admin already ended.
 */
export function endPlanNow(actor: Actor): Promise<void> {
  return orgLock(actor.orgId, async () => {
    const row = await loadOrg(actor.orgId);
    assertNotComplimentary(row);
    const customerId = liveCustomerId(row);
    if (!customerId) throw new BillingError("no_plan");
    await syncEmail(actor, customerId);

    const sub = pickCurrent(await subscriptionsOf(customerId));
    if (!sub || (sub.status !== "past_due" && sub.status !== "unpaid")) throw new BillingError("no_plan");
    if (sub.schedule) await stripe().subscriptionSchedules.release(idOf(sub.schedule));
    await stripe().subscriptions.cancel(sub.id, { invoice_now: false, prorate: false });
    const open = await stripe().invoices.list({ subscription: sub.id, status: "open", limit: 20 });
    for (const invoice of open.data) await stripe().invoices.voidInvoice(invoice.id);
    await refresh(customerId);
  });
}

/** Undo a pending cancellation, including a dashboard `cancel_at` beyond this period. */
export function resume(actor: Actor): Promise<void> {
  return orgLock(actor.orgId, async () => {
    const row = await loadOrg(actor.orgId);
    assertNotComplimentary(row);
    const customerId = liveCustomerId(row);
    if (!customerId) throw new BillingError("no_plan");
    await syncEmail(actor, customerId);

    const sub = pickCurrent(await subscriptionsOf(customerId));
    if (!sub || (sub.status !== "active" && sub.status !== "trialing")) throw new BillingError("no_plan");
    if (sub.cancel_at_period_end) await stripe().subscriptions.update(sub.id, { cancel_at_period_end: false });
    else if (sub.cancel_at !== null) await stripe().subscriptions.update(sub.id, { cancel_at: "" });
    await refresh(customerId);
  });
}

// ── Card and invoices ────────────────────────────────────────────────────────

let portalConfigId: string | undefined;

/** Stripe's hosted page for updating the card and downloading invoices. Plan changes stay in-app. */
export async function portalUrl(actor: Actor): Promise<string> {
  const row = await loadOrg(actor.orgId);
  assertNotComplimentary(row);
  const customerId = liveCustomerId(row);
  if (!customerId) throw new BillingError("no_plan");
  await syncEmail(actor, customerId);

  if (!portalConfigId) {
    const { data } = await stripe().billingPortal.configurations.list({ active: true, limit: 100 });
    portalConfigId = data.find((c) => c.metadata?.app === PORTAL_TAG)?.id;
    if (!portalConfigId) throw new BillingError("portal_not_setup");
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: customerId,
    configuration: portalConfigId,
    return_url: `${siteOrigin()}${SETTINGS_PLAN_PATH}`,
  });
  return assertStripeUrl(session.url);
}

/** Test seam: the portal configuration is cached in-process. */
export function clearPortalConfigCache(): void {
  portalConfigId = undefined;
}

// ── Suspend / reinstate (D3) ──────────────────────────────────────────────────

/** Pauses or resumes collection on a live subscription while staff suspend or reinstate an org
 *  (D3): Stripe stops charging a card for access no one can use. No-op when billing is off,
 *  there is no customer (or it belongs to the other mode), or no subscription is live. */
export async function setCollectionPaused(orgId: string, paused: boolean): Promise<void> {
  await orgLock(orgId, async () => {
    if (!billingEnabled()) return;
    const row = await loadOrg(orgId);
    const customerId = liveCustomerId(row);
    if (!customerId) return;
    const sub = pickCurrent(await subscriptionsOf(customerId));
    if (!sub || !isLive(sub.status)) return;
    await stripe().subscriptions.update(sub.id, { pause_collection: paused ? { behavior: "void" } : "" });
    await refresh(customerId);
  });
}

/**
 * Staff granting complimentary access to a paying org (§4.6) end the paid plan in the same step,
 * so the org is never billed for access it now gets free. `now` cancels without a refund or a
 * final invoice (the unused time is not credited); `period_end` lets the paid period run out.
 * No-op when billing is off, there is no customer for this mode, or nothing is live.
 */
export async function staffCancelSubscription(orgId: string, when: "now" | "period_end"): Promise<void> {
  await orgLock(orgId, async () => {
    if (!billingEnabled()) return;
    const customerId = liveCustomerId(await loadOrg(orgId));
    if (!customerId) return;
    const sub = pickCurrent(await subscriptionsOf(customerId));
    if (!sub || !isLive(sub.status)) return;
    if (sub.schedule) await stripe().subscriptionSchedules.release(idOf(sub.schedule));
    if (when === "now") {
      await stripe().subscriptions.cancel(sub.id, { invoice_now: false, prorate: false });
      // Same as endPlanNow: an unpaid renewal must not be collected later for a plan that ended.
      const open = await stripe().invoices.list({ subscription: sub.id, status: "open", limit: 20 });
      for (const invoice of open.data) await stripe().invoices.voidInvoice(invoice.id);
    } else {
      await stripe().subscriptions.update(sub.id, { cancel_at_period_end: true });
    }
    await refresh(customerId);
  });
}

// ── Queued downgrade to Reconciliation (P24, read by Phase 6's funding-source create) ────────

/**
 * When a queued change is a downgrade to Reconciliation, the date it starts — so an admin can't
 * add a second funding source while it waits (P24). `null` when billing is off, the org is
 * complimentary now, there's no customer for this mode, nothing is queued, the queued phase is a
 * price move (P21, not a plan downgrade), or the queue isn't actually a downgrade to
 * Reconciliation.
 */
export async function queuedDowngradeToReconciliation(orgId: string): Promise<Date | null> {
  if (!billingEnabled()) return null;
  const row = await loadOrg(orgId);
  if (isComplimentaryNow(row, todayIso())) return null;
  const customerId = liveCustomerId(row);
  if (!customerId) return null;

  const sub = pickCurrent(await subscriptionsOf(customerId));
  if (!sub?.schedule) return null;
  const schedule = await stripe().subscriptionSchedules.retrieve(idOf(sub.schedule), {
    expand: ["phases.items.price"],
  });
  const queued = futurePhase(schedule);
  if (!queued || queued.metadata?.reason === "price_move") return null;

  const queuedPrice = queued.items[0]?.price as Stripe.Price | undefined;
  const currentPrice = sub.items.data[0].price;
  if (queuedPrice?.metadata?.plan !== "reconciliation" || currentPrice.metadata?.plan === "reconciliation") {
    return null;
  }

  return new Date(queued.start_date * 1000);
}

// ── Price moves (P21, "move-subscribers") ────────────────────────────────────

export type PriceMoveResult = {
  moved: { orgId: string; fromPriceId: string; toPriceId: string; effectiveAt: string }[];
  skipped: { orgId: string; reason: string }[];
};

/**
 * Every org, in this Stripe mode, with a live subscription whose price no longer matches the
 * active price for its lookup key. `apply: false` (the default the script uses first) changes
 * nothing in Stripe and only reports what would happen.
 */
export async function planPriceMoves(opts: { apply: boolean }): Promise<PriceMoveResult> {
  const live = stripeKeyIsLive();
  const orgs = await db
    .select({ id: organizations.id, customerId: organizations.stripeCustomerId })
    .from(organizations)
    .where(and(sql`${organizations.stripeCustomerId} IS NOT NULL`, eq(organizations.stripeLivemode, live)));

  const moved: PriceMoveResult["moved"] = [];
  const skipped: PriceMoveResult["skipped"] = [];

  for (const o of orgs) {
    const customerId = o.customerId!;
    const subs = await subscriptionsOf(customerId);
    const sub = subs.find((s) => isLive(s.status));
    if (!sub) continue;

    const item = sub.items.data[0];
    const currentPrice = item.price;
    let active: Stripe.Price;
    try {
      active = await activePriceFor(currentPrice);
    } catch {
      skipped.push({ orgId: o.id, reason: `price ${currentPrice.id} has no valid metadata.plan/interval` });
      continue;
    }
    if (active.id === currentPrice.id) continue; // already on the current price

    if (sub.pending_update) {
      skipped.push({ orgId: o.id, reason: "an upgrade is awaiting payment" });
      continue;
    }
    if (sub.cancel_at_period_end || sub.cancel_at !== null) {
      skipped.push({ orgId: o.id, reason: "cancelling" });
      continue;
    }

    const schedule = sub.schedule
      ? await stripe().subscriptionSchedules.retrieve(idOf(sub.schedule), { expand: ["phases.items.price"] })
      : null;
    const queued = schedule ? futurePhase(schedule) : undefined;

    if (opts.apply) {
      if (queued) {
        const queuedPrice = queued.items[0]?.price as Stripe.Price;
        const activeForQueued = await activePriceFor(queuedPrice);
        if (activeForQueued.id !== queuedPrice.id) {
          // Keep what the queued phase already is: a price move queued before a second price
          // change must stay a price move, or it would block upgrades as if it were a downgrade.
          const reason = queued.metadata?.reason === "price_move" ? "price_move" : "downgrade";
          await retagFuturePhase(schedule!, activeForQueued, reason);
        }
      } else {
        await createOrExtendSchedule(sub, item, active, schedule, "price_move");
      }
    }

    moved.push({
      orgId: o.id,
      fromPriceId: currentPrice.id,
      toPriceId: active.id,
      effectiveAt: new Date(item.current_period_end * 1000).toISOString(),
    });
  }

  return { moved, skipped };
}
