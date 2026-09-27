/**
 * Billing against the REAL Stripe sandbox, with test clocks to fast-forward time (Phase 16 §8.3).
 * Proves what Stripe actually charges, to the cent, rather than what we assume. Ported from the
 * reference build's `tests/billing.test.ts` (node:test on SQLite) to vitest on Postgres orgs.
 *
 * Each test gets its own test clock, customer and org (`createTestOrg({ complimentary: false })`)
 * and deletes the clock afterwards (which deletes the customer and its subscriptions), so the
 * sandbox is left clean and tests run concurrently. Never skips: without a `sk_test_` key and a
 * database this throws at load (`npm run test:stripe`).
 */
import { randomUUID } from "node:crypto";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") || !process.env.DATABASE_URL) {
  throw new Error("npm run test:stripe requires STRIPE_SECRET_KEY (sk_test_...) and DATABASE_URL.");
}
process.env.BILLING_ENABLED = "true";
process.env.STRIPE_WEBHOOK_SECRET ||= "whsec_sandbox_suite";

import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/src/db";
import { fundingSources, orgAccountEvents, organizations } from "@/src/db/schema";
import { createTestOrg, orgWithBilling, setBillingCopy } from "@/src/db/test-org";
import { todayIso } from "@/src/domain/dates";
import { ORIGINAL_RULES } from "@/src/modules/expenses/reimbursement";
import { aiPlanAllowed } from "@/src/modules/ai/access";
import * as billing from "@/src/modules/billing/billing";
import { billingEnabled } from "@/src/modules/billing/config";
import { orgEntitlement } from "@/src/modules/billing/entitlement";
import { lookupKey, priceCents } from "@/src/modules/billing/pricing";
import { INTERVALS, type Interval, type PlanId } from "@/src/modules/billing/rules";
import { stripe } from "@/src/modules/billing/stripe";
import { flagDispute, refreshOrgBilling, syncOrgBilling } from "@/src/modules/billing/sync";
import { handleWebhook } from "@/src/modules/billing/webhook";

const { BillingError } = billing;
type Actor = { orgId: string; email: string };

const s = stripe();
const clocks: string[] = [];
const orgIds: string[] = [];
const throwawayProducts: string[] = [];

afterAll(async () => {
  await Promise.allSettled(clocks.map((id) => s.testHelpers.testClocks.del(id)));
  await Promise.allSettled(throwawayProducts.map((id) => s.products.update(id, { active: false }).catch(() => {})));
  for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const PLANS: PlanId[] = ["reconciliation", "reconciliation_ai"];

async function price(plan: PlanId, interval: Interval): Promise<Stripe.Price> {
  const [p] = (await s.prices.list({ lookup_keys: [lookupKey(plan, interval)], active: true })).data;
  if (!p) throw new Error(`no active price for ${lookupKey(plan, interval)}: run npm run billing:setup`);
  return p;
}

type Fixture = { orgId: string; customerId: string; clockId: string; start: number };

/** An unpaid org with a Stripe customer on its own test clock, paying with a working test card. */
async function fixture(): Promise<Fixture> {
  const start = Math.floor(Date.now() / 1000);
  const clock = await s.testHelpers.testClocks.create({ frozen_time: start, name: "stay funded 360 test" });
  clocks.push(clock.id);
  const { orgId } = await createTestOrg({ name: `Billing ${randomUUID()}`, complimentary: false });
  orgIds.push(orgId);
  const customer = await s.customers.create({ test_clock: clock.id, metadata: { orgId } });
  await setBillingCopy(orgId, { stripeCustomerId: customer.id, livemode: false });
  await setDefaultCard(customer.id, "pm_card_visa");
  return { orgId, customerId: customer.id, clockId: clock.id, start };
}

/** Make a test card the customer's default. pm_card_chargeCustomerFail saves fine but declines every charge. */
async function setDefaultCard(customerId: string, testCard: string): Promise<string> {
  const pm = await s.paymentMethods.attach(testCard, { customer: customerId });
  await s.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });
  return pm.id;
}

/** Stand-in for a completed Checkout: a paid subscription on the given plan. */
async function subscribe(f: Fixture, plan: PlanId, interval: Interval): Promise<Stripe.Subscription> {
  const sub = await s.subscriptions.create({
    customer: f.customerId,
    items: [{ price: (await price(plan, interval)).id }],
    payment_behavior: "error_if_incomplete",
  });
  expect(sub.status).toBe("active");
  await syncOrgBilling(f.customerId);
  return sub;
}

/** The org row with its `org_billing` copy spread over it. */
async function org(f: Fixture) {
  return orgWithBilling(f.orgId);
}

async function history(f: Fixture) {
  return db.select().from(orgAccountEvents).where(eq(orgAccountEvents.orgId, f.orgId));
}

// ── Helpers for Phase 3's billing actions (S-1 to S-30) ─────────────────────

const DAY = 86_400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function actorOf(f: Fixture, email = `t-${randomUUID()}@example.com`): Actor {
  return { orgId: f.orgId, email };
}

/** Stripe lets a clock jump at most two of its shortest billing interval at once, so go in
 *  ≤55-day steps (ported from the reference build unchanged). */
async function advance(f: Fixture, toSeconds: number): Promise<void> {
  let at = (await s.testHelpers.testClocks.retrieve(f.clockId)).frozen_time;
  while (at < toSeconds) {
    at = Math.min(toSeconds, at + 55 * DAY);
    await s.testHelpers.testClocks.advance(f.clockId, { frozen_time: at });
    await clockReady(f.clockId);
  }
  await syncOrgBilling(f.customerId);
}

/** Up to 15 minutes: an advance through a declined payment took 6.4 minutes in the sandbox. */
async function clockReady(clockId: string): Promise<void> {
  for (let i = 0; i < 450; i++) {
    const c = await s.testHelpers.testClocks.retrieve(clockId);
    if (c.status === "ready") return;
    if (c.status === "internal_failure") throw new Error(`test clock ${clockId} failed`);
    await sleep(2000);
  }
  throw new Error("test clock did not finish advancing in 15 minutes");
}

/** The subscription that counts, straight from Stripe (mirrors `pickCurrent`). */
async function currentSub(f: Fixture): Promise<Stripe.Subscription> {
  const subs = (await s.subscriptions.list({ customer: f.customerId, status: "all", limit: 20 })).data;
  const live = subs.filter((sub) => sub.status !== "canceled");
  const sub = (live.length ? live : subs).sort((a, b) => b.created - a.created)[0];
  if (!sub) throw new Error(`no subscription for ${f.customerId}`);
  return sub;
}

const invoicesOf = async (f: Fixture) => (await s.invoices.list({ customer: f.customerId, limit: 30 })).data;
const paidTotal = async (f: Fixture) => (await invoicesOf(f)).reduce((sum, i) => sum + i.amount_paid, 0);
const pendingItems = async (f: Fixture) => (await s.invoiceItems.list({ customer: f.customerId, pending: true })).data;

async function nextInvoiceTotal(f: Fixture): Promise<number> {
  const sub = await currentSub(f);
  return (await s.invoices.createPreview({ customer: f.customerId, subscription: sub.id })).total;
}

/**
 * The invariant behind "no free time" (§8.3): the subscription's current period is covered by a
 * PAID charge for the price it's on now. Catches any deferred or backdated period, whatever path
 * caused it. Ported from the reference build's `assertPaidThrough`.
 */
async function assertPaidThrough(f: Fixture): Promise<void> {
  const sub = await currentSub(f);
  const item = sub.items.data[0];
  const paid = (await s.invoices.list({ customer: f.customerId, status: "paid", limit: 50 })).data;
  const coveredTo = Math.max(
    0,
    ...paid.flatMap((inv) =>
      inv.lines.data
        .filter((l) => {
          const p = l.pricing?.price_details?.price;
          return l.amount > 0 && (typeof p === "string" ? p : p?.id) === item.price.id;
        })
        .map((l) => l.period.end),
    ),
  );
  expect(
    coveredTo,
    `unpaid time: ${item.price.lookup_key ?? item.price.id} period ends ${new Date(item.current_period_end * 1000).toISOString()} but paid only to ${new Date(coveredTo * 1000).toISOString()}`,
  ).toBeGreaterThanOrEqual(item.current_period_end);
}

/** Asserts `p` rejects with a `BillingError` of exactly `code` (`p` is already an invoked
 *  promise, so awaiting it twice below re-checks the same call, never re-runs the action). */
async function rejects(p: Promise<unknown>, code: billing.BillingErrorCode): Promise<void> {
  await expect(p).rejects.toBeInstanceOf(BillingError);
  await expect(p).rejects.toMatchObject({ code });
}

/** `orgEntitlement`'s verdict, plus the AI gate, for the org's row right now (Phase 16, §4.2). */
async function access(f: Fixture): Promise<{ paid: boolean; ai: boolean }> {
  const row = await org(f);
  const ent = orgEntitlement(
    {
      plan: row.plan,
      complimentary: row.complimentary,
      complimentaryUntil: row.complimentaryUntil,
      complimentaryPlan: row.complimentaryPlan,
      stripeStatus: row.stripeStatus ?? null,
    },
    todayIso(),
    billingEnabled(),
  );
  return { paid: ent.paid, ai: ent.paid && aiPlanAllowed(row.plan) };
}

/** A second active funding source for an org that `fixture()` already gave one (P24 guard). */
async function addFundingSource(orgId: string): Promise<void> {
  await db.insert(fundingSources).values({ orgId, name: `Source ${randomUUID()}`, type: "grant", sortOrder: 1, ...ORIGINAL_RULES });
}

/** A throwaway Stripe price, on its own product, never sharing a lookup key with `pricing.ts`
 *  (S-28, S-29): exercises `findPrice`/`planPriceMoves`'s price-matching logic without ever
 *  touching the real `sf360_*` lookup keys the whole concurrent suite depends on. */
async function throwawayPrice(plan: PlanId, interval: Interval, unitAmountCents: number, active = true): Promise<Stripe.Price> {
  const product = await s.products.create({ name: `sf360 test throwaway ${randomUUID()}` });
  throwawayProducts.push(product.id);
  return s.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: unitAmountCents,
    recurring: { interval },
    metadata: { plan },
    active,
  });
}

/** Stand-in for a completed Checkout on an arbitrary (possibly throwaway) price — bypasses
 *  `billing.startCheckout`, which only ever resolves the real lookup-keyed price. */
async function subscribeToPrice(f: Fixture, priceId: string): Promise<Stripe.Subscription> {
  const sub = await s.subscriptions.create({ customer: f.customerId, items: [{ price: priceId }], payment_behavior: "error_if_incomplete" });
  expect(sub.status).toBe("active");
  await syncOrgBilling(f.customerId);
  return sub;
}

/** Builds (or extends) a subscription schedule by hand, outside `billing.ts`, so a test can set
 *  up "a queued phase already exists" without going through `applyChange` (which always targets
 *  the real active price). Mirrors `createOrExtendSchedule`'s phase shape. */
async function queuePhase(sub: Stripe.Subscription, targetPrice: Stripe.Price, reason?: "price_move"): Promise<Stripe.SubscriptionSchedule> {
  const schedule = await s.subscriptionSchedules.create({ from_subscription: sub.id });
  const current = schedule.current_phase!;
  const currentPhase = schedule.phases.find((p) => p.start_date === current.start_date)!;
  return s.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [
      {
        items: currentPhase.items.map((i) => ({ price: typeof i.price === "string" ? i.price : i.price.id, quantity: i.quantity ?? 1 })),
        start_date: current.start_date,
        end_date: current.end_date,
      },
      {
        items: [{ price: targetPrice.id, quantity: 1 }],
        duration: { interval: targetPrice.recurring!.interval, interval_count: 1 },
        proration_behavior: "none",
        billing_cycle_anchor: "phase_start",
        ...(reason ? { metadata: { reason } } : {}),
      },
    ],
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe.concurrent("billing against the Stripe sandbox: sync and safety nets (Phase 2)", () => {
  it("S-26: Stripe's active prices equal pricing.ts, with metadata, interval, USD, one per lookup key", async () => {
    for (const plan of PLANS) {
      for (const interval of INTERVALS) {
        const { data } = await s.prices.list({ lookup_keys: [lookupKey(plan, interval)], active: true });
        expect(data, lookupKey(plan, interval)).toHaveLength(1);
        const [p] = data;
        expect(p.unit_amount).toBe(priceCents(plan, interval));
        expect(p.currency).toBe("usd");
        expect(p.recurring?.interval).toBe(interval);
        expect(p.recurring?.interval_count).toBe(1);
        expect(p.metadata.plan).toBe(plan);
      }
    }
  });

  it("S-24: sync is idempotent, and writes one Stripe History row for the change", async () => {
    const f = await fixture();
    await subscribe(f, "reconciliation_ai", "month");
    const once = await org(f);
    expect(once.stripeStatus).toBe("active");
    expect(once.plan).toBe("reconciliation_ai");
    expect(once.subscriptionStatus).toBe("active");
    expect(once.billingInterval).toBe("month");
    expect(once.currentPeriodEnd).not.toBeNull();

    await syncOrgBilling(f.customerId);
    await syncOrgBilling(f.customerId);
    const thrice = await org(f);
    expect({ ...thrice, syncedAt: null, updatedAt: null }).toEqual({ ...once, syncedAt: null, updatedAt: null });

    const rows = await history(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "plan_changed", viaStripe: true, actorStaffId: null });
    expect(rows[0].before).toMatchObject({ plan: "reconciliation", status: "trial" });
    expect(rows[0].after).toMatchObject({ plan: "reconciliation_ai", status: "active" });
  });

  it("S-25: a customer deleted in Stripe leaves the org unpaid", async () => {
    const f = await fixture();
    await subscribe(f, "reconciliation", "month");
    // Deleting a customer cancels its subscriptions; Stripe still lists them as canceled.
    await s.customers.del(f.customerId);
    await syncOrgBilling(f.customerId);
    const row = await org(f);
    expect(row.stripeStatus).toBe("canceled");
    expect(row.subscriptionStatus).toBe("cancelled");
    expect(row.plan).toBe("reconciliation"); // a dead subscription never writes the plan (P27)
  });

  it("lost webhook: a signed webhook repairs the copy; an unknown customer is acknowledged and skipped", async () => {
    const f = await fixture();
    await subscribe(f, "reconciliation", "month");
    await setBillingCopy(f.orgId, { stripeStatus: null });

    const secret = "whsec_integration";
    const deps = { secret, live: false, sync: syncOrgBilling, dispute: flagDispute };
    const body = JSON.stringify({ id: "evt_x", object: "event", livemode: false, type: "invoice.paid", data: { object: { customer: f.customerId } } });
    const sig = s.webhooks.generateTestHeaderString({ payload: body, secret });
    expect((await handleWebhook(body, sig, deps)).status).toBe(200);
    expect((await org(f)).stripeStatus).toBe("active");

    // Another business's customer on the same account (D1): no org here, so no Stripe call and 200.
    expect(await syncOrgBilling("cus_not_ours_at_all")).toBe("unknown_customer");
  });

  it("a customer stored for the other Stripe mode is treated as absent (P11)", async () => {
    const f = await fixture();
    await subscribe(f, "reconciliation", "month");
    await setBillingCopy(f.orgId, { livemode: true, stripeStatus: null });
    expect(await syncOrgBilling(f.customerId)).toBe("unknown_customer");
    expect((await org(f)).stripeStatus).toBeNull();
  });
});

describe.concurrent("billing against the Stripe sandbox: Phase 3's billing actions (S-1 to S-23, S-27, S-29, S-30)", () => {
  it("S-1: checkout returns a Stripe URL, keeps only one open session, refuses a second subscription", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    const url1 = await billing.startCheckout(actor, "reconciliation", "month");
    expect(url1).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const url2 = await billing.startCheckout(actor, "reconciliation_ai", "year");
    expect(url2).not.toBe(url1);
    const open = await s.checkout.sessions.list({ customer: f.customerId, status: "open" });
    expect(open.data, "the older tab's checkout was expired").toHaveLength(1);
    const session = open.data[0];
    expect(session.mode).toBe("subscription");
    expect(session.client_reference_id).toBe(f.orgId);
    const items = await s.checkout.sessions.listLineItems(session.id);
    expect(items.data[0].price!.id).toBe((await price("reconciliation_ai", "year")).id);

    // Same customer can't be sent to Checkout while it has a live subscription.
    await subscribe(f, "reconciliation", "month");
    await rejects(billing.startCheckout(actor, "reconciliation", "year"), "already_subscribed");
    expect((await org(f)).plan).toBe("reconciliation");
    await rejects(billing.startCheckout(actor, "enterprise", "month"), "unknown_plan");
  });

  it("S-2: upgrade mid-month charged the exact quoted difference today, next bill is clean", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "month");
    const periodEnd = (await org(f)).currentPeriodEnd!.getTime();
    await advance(f, f.start + 10 * DAY);

    const quote = await billing.quoteChange(actor, "reconciliation_ai", "month");
    expect(quote.change).toBe("now");
    expect(quote.dueTodayCents).toBeGreaterThan(0);
    expect(quote.dueTodayCents).toBeLessThan(priceCents("reconciliation_ai", "month") - priceCents("reconciliation", "month"));

    const r = await billing.applyChange(actor, "reconciliation_ai", "month", quote.prorationDate);
    expect(r).toEqual({ result: "changed" });
    const row = await org(f);
    expect(row.plan).toBe("reconciliation_ai");
    expect(row.currentPeriodEnd!.getTime()).toBe(periodEnd);
    expect((await access(f)).ai).toBe(true);

    const upgradeInvoice = (await invoicesOf(f)).find((i) => i.billing_reason === "subscription_update")!;
    expect(upgradeInvoice.status).toBe("paid");
    expect(upgradeInvoice.amount_paid).toBe(quote.dueTodayCents);
    expect(await pendingItems(f)).toEqual([]);
    expect(await nextInvoiceTotal(f)).toBe(priceCents("reconciliation_ai", "month"));
    await assertPaidThrough(f);
  });

  it("S-3: upgrade monthly to yearly, charged now, keeps the original billing date, nothing deferred", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "month");
    await advance(f, f.start + 10 * DAY);

    const quote = await billing.quoteChange(actor, "reconciliation", "year");
    expect(quote.change).toBe("now");
    expect(quote.dueTodayCents).toBeGreaterThan(0);
    expect(quote.dueTodayCents).toBeLessThan(priceCents("reconciliation", "year"));

    expect(await billing.applyChange(actor, "reconciliation", "year", quote.prorationDate)).toEqual({ result: "changed" });
    const row = await org(f);
    expect(row.billingInterval).toBe("year");
    // Stripe keeps the original billing anchor (it does not restart the year on the switch day).
    const yearFromStart = new Date(f.start * 1000);
    yearFromStart.setUTCFullYear(yearFromStart.getUTCFullYear() + 1);
    expect(row.currentPeriodEnd!.getTime()).toBe(yearFromStart.getTime());
    expect(quote.nextChargeAt).toBe(row.currentPeriodEnd!.getTime());

    const upgrade = (await invoicesOf(f)).find((i) => i.billing_reason === "subscription_update")!;
    expect(upgrade.amount_paid).toBe(quote.dueTodayCents);
    expect(await pendingItems(f)).toEqual([]);
    expect(await nextInvoiceTotal(f)).toBe(priceCents("reconciliation", "year"));
    expect(await paidTotal(f)).toBe(priceCents("reconciliation", "month") + quote.dueTodayCents);
    await assertPaidThrough(f);
  });

  it("S-4: a declining card leaves the plan unchanged, sends the admin to pay, and nothing leaks after expiry", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "month");
    await advance(f, f.start + 5 * DAY);
    await setDefaultCard(f.customerId, "pm_card_chargeCustomerFail");

    const quote = await billing.quoteChange(actor, "reconciliation_ai", "month");
    const r = await billing.applyChange(actor, "reconciliation_ai", "month", quote.prorationDate);
    expect(r.result).toBe("payment_needed");
    expect((r as { payUrl: string }).payUrl).toMatch(/^https:\/\/invoice\.stripe\.com\//);
    const row = await org(f);
    expect(row.plan).toBe("reconciliation");
    expect((await access(f)).ai).toBe(false);
    expect(row.upgradePayUrl ?? "").toMatch(/^https:\/\/invoice\.stripe\.com\//);

    // While it waits for payment, nothing else can change the subscription.
    await rejects(billing.quoteChange(actor, "reconciliation", "year"), "payment_pending");
    await rejects(billing.applyChange(actor, "reconciliation_ai", "year", quote.prorationDate), "payment_pending");
    await rejects(billing.cancelAtPeriodEnd(actor), "payment_pending");

    // The customer walks away. After the pending update expires (23h), nothing is owed and nothing changed.
    await advance(f, f.start + 5 * DAY + 2 * DAY);
    expect((await org(f)).plan).toBe("reconciliation");
    expect((await org(f)).upgradePayUrl).toBeNull();
    expect(await paidTotal(f)).toBe(priceCents("reconciliation", "month"));
    expect(await pendingItems(f)).toEqual([]);
    const stillOpen = (await invoicesOf(f)).filter((i) => i.status === "open");
    expect(stillOpen).toEqual([]);

    // Even once the card works again, the dropped upgrade is never charged.
    await setDefaultCard(f.customerId, "pm_card_visa");
    await advance(f, f.start + 5 * DAY + 5 * DAY);
    expect(await paidTotal(f)).toBe(priceCents("reconciliation", "month"));
    expect((await org(f)).plan).toBe("reconciliation");
    await assertPaidThrough(f);
  });

  it("S-5: declined then paid on Stripe's hosted page applies the upgrade", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "month");
    await advance(f, f.start + 5 * DAY);
    await setDefaultCard(f.customerId, "pm_card_chargeCustomerFail");

    const quote = await billing.quoteChange(actor, "reconciliation_ai", "month");
    const r = await billing.applyChange(actor, "reconciliation_ai", "month", quote.prorationDate);
    expect(r.result).toBe("payment_needed");

    const good = await setDefaultCard(f.customerId, "pm_card_visa");
    const open = (await invoicesOf(f)).find((i) => i.status === "open")!;
    await s.invoices.pay(open.id, { payment_method: good });
    await syncOrgBilling(f.customerId); // the invoice.paid webhook does this in the app
    expect((await org(f)).plan).toBe("reconciliation_ai");
    expect(await paidTotal(f)).toBe(priceCents("reconciliation", "month") + quote.dueTodayCents);
    await assertPaidThrough(f);
  });

  it("S-6: downgrade charges nothing today, keeps features, bills the lower price at period end", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation_ai", "month");
    const periodEnd = (await org(f)).currentPeriodEnd!.getTime();
    await advance(f, f.start + 5 * DAY);

    const quote = await billing.quoteChange(actor, "reconciliation", "month");
    expect(quote.change).toBe("at_period_end");
    expect(quote.dueTodayCents).toBe(0);
    expect(quote.effectiveAt).toBe(periodEnd);
    const invoicesBefore = (await invoicesOf(f)).length;

    expect(await billing.applyChange(actor, "reconciliation", "month", 0)).toEqual({ result: "scheduled" });
    let row = await org(f);
    expect(row.plan, "keeps what they paid for").toBe("reconciliation_ai");
    expect((await access(f)).ai).toBe(true);
    expect(row.pendingPlan).toBe("reconciliation");
    expect(row.pendingInterval).toBe("month");
    expect(row.pendingAt!.getTime()).toBe(periodEnd);
    expect((await invoicesOf(f)).length).toBe(invoicesBefore);

    await advance(f, periodEnd / 1000 + 2 * 3600);
    row = await org(f);
    expect(row.plan).toBe("reconciliation");
    expect(row.pendingPlan).toBeNull();
    expect((await access(f)).ai).toBe(false);
    expect((await invoicesOf(f))[0].amount_paid).toBe(priceCents("reconciliation", "month"));
    expect(await paidTotal(f)).toBe(priceCents("reconciliation_ai", "month") + priceCents("reconciliation", "month"));
    await assertPaidThrough(f);
  });

  it("S-7: cancelling a queued downgrade renews on the original plan and price", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation_ai", "month");
    const periodEnd = (await org(f)).currentPeriodEnd!.getTime();
    await billing.applyChange(actor, "reconciliation", "month", 0);
    expect((await org(f)).pendingPlan).toBe("reconciliation");

    await billing.cancelPendingChange(actor);
    expect((await org(f)).pendingPlan).toBeNull();

    await advance(f, periodEnd / 1000 + 2 * 3600);
    expect((await org(f)).plan).toBe("reconciliation_ai");
    expect((await invoicesOf(f))[0].amount_paid).toBe(priceCents("reconciliation_ai", "month"));
    await assertPaidThrough(f);
  });

  it("S-8: yearly to monthly waits for the year to end, then bills monthly", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "year");
    const yearEnd = (await org(f)).currentPeriodEnd!.getTime();
    const quote = await billing.quoteChange(actor, "reconciliation", "month");
    expect(quote.change).toBe("at_period_end");
    expect(quote.effectiveAt).toBe(yearEnd);
    await billing.applyChange(actor, "reconciliation", "month", 0);

    await advance(f, yearEnd / 1000 + 2 * 3600);
    const row = await org(f);
    expect(row.billingInterval).toBe("month");
    expect(row.pendingPlan).toBeNull();
    expect((await invoicesOf(f))[0].amount_paid).toBe(priceCents("reconciliation", "month"));
    expect(await paidTotal(f)).toBe(priceCents("reconciliation", "year") + priceCents("reconciliation", "month"));
    await assertPaidThrough(f);
  });

  it("S-9: an upgrade is refused while a downgrade is queued; another downgrade replaces it; cancelling lets the upgrade through", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "year");
    await billing.applyChange(actor, "reconciliation", "month", 0); // queued: yearly → monthly
    expect((await org(f)).pendingInterval).toBe("month");
    await advance(f, f.start + 30 * DAY);

    // Refused rather than silently dropping the queued change (which a declined card would then lose).
    await rejects(billing.quoteChange(actor, "reconciliation_ai", "year"), "change_pending");
    await rejects(billing.applyChange(actor, "reconciliation_ai", "year", f.start + 30 * DAY), "change_pending");
    expect((await org(f)).pendingInterval, "the queued change is untouched").toBe("month");
    // Replacing the queued downgrade with another downgrade is fine.
    await billing.applyChange(actor, "reconciliation", "month", 0);
    await billing.cancelPendingChange(actor);

    const quote = await billing.quoteChange(actor, "reconciliation_ai", "year");
    expect(quote.change).toBe("now");
    expect(await billing.applyChange(actor, "reconciliation_ai", "year", quote.prorationDate)).toEqual({ result: "changed" });
    const row = await org(f);
    expect(row.plan).toBe("reconciliation_ai");
    expect(row.billingInterval).toBe("year");
    expect(row.pendingPlan, "the queued downgrade is gone").toBeNull();
    expect((await currentSub(f)).schedule).toBeNull();
    expect(await paidTotal(f)).toBe(priceCents("reconciliation", "year") + quote.dueTodayCents);
    await assertPaidThrough(f);
  });

  it("S-10: cancel at period end, resume undoes it, then access ends with no further charge", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "month");
    const periodEnd = (await org(f)).currentPeriodEnd!.getTime();

    await billing.cancelAtPeriodEnd(actor);
    let row = await org(f);
    expect(row.cancelAtPeriodEnd).toBe(true);
    expect((await access(f)).paid, "still paid up").toBe(true);
    await rejects(billing.quoteChange(actor, "reconciliation_ai", "month"), "cancel_pending");
    await rejects(billing.cancelAtPeriodEnd(actor), "cancel_pending");

    await billing.resume(actor);
    expect((await org(f)).cancelAtPeriodEnd).toBe(false);
    await billing.cancelAtPeriodEnd(actor);

    await advance(f, f.start + 20 * DAY);
    expect((await access(f)).paid, "day 20: still in the paid month").toBe(true);
    await advance(f, periodEnd / 1000 + 2 * 3600);
    row = await org(f);
    expect(row.subscriptionStatus).toBe("cancelled");
    expect((await access(f)).paid, "access ends at the end of the paid month").toBe(false);
    expect(await paidTotal(f), "never charged again").toBe(priceCents("reconciliation", "month"));
    await rejects(billing.resume(actor), "no_plan");
  });

  it("S-11: cancelling drops a queued downgrade", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation_ai", "month");
    await billing.applyChange(actor, "reconciliation", "month", 0);
    await billing.cancelAtPeriodEnd(actor);
    const row = await org(f);
    expect(row.pendingPlan).toBeNull();
    expect(row.cancelAtPeriodEnd).toBe(true);
  });

  it("S-12: renewal charges again, period moves forward a month", async () => {
    const f = await fixture();
    await subscribe(f, "reconciliation", "month");
    const firstEnd = (await org(f)).currentPeriodEnd!.getTime();
    await advance(f, firstEnd / 1000 + 2 * 3600);
    const row = await org(f);
    expect(row.subscriptionStatus).toBe("active");
    expect(row.currentPeriodEnd!.getTime()).toBeGreaterThan(firstEnd + 27 * DAY * 1000);
    expect(await paidTotal(f)).toBe(priceCents("reconciliation", "month") * 2);
    await assertPaidThrough(f);
  });

  it("S-13: a failed renewal is past_due, keeps access, blocks switching; fixing the card restores active", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "month");
    const periodEnd = (await org(f)).currentPeriodEnd!.getTime();
    await setDefaultCard(f.customerId, "pm_card_chargeCustomerFail");

    await advance(f, periodEnd / 1000 + 2 * 3600);
    let row = await org(f);
    expect(row.stripeStatus).toBe("past_due");
    expect((await access(f)).paid, "access continues while Stripe retries").toBe(true);
    await rejects(billing.quoteChange(actor, "reconciliation_ai", "month"), "payment_failed");

    const good = await setDefaultCard(f.customerId, "pm_card_visa");
    const open = (await invoicesOf(f)).find((i) => i.status === "open")!;
    await s.invoices.pay(open.id, { payment_method: good });
    await syncOrgBilling(f.customerId);
    row = await org(f);
    expect(row.stripeStatus).toBe("active");
    expect(await paidTotal(f)).toBe(priceCents("reconciliation", "month") * 2);
    await assertPaidThrough(f);
  });

  it("S-14: guards refuse same plan, unknown plan, and a forged, future, stale or NaN quote; nothing charged", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "month");
    await rejects(billing.quoteChange(actor, "reconciliation", "month"), "same_plan");
    await rejects(billing.quoteChange(actor, "enterprise", "month"), "unknown_plan");
    await rejects(billing.quoteChange(actor, "reconciliation", "week"), "unknown_plan");
    await rejects(billing.applyChange(actor, "reconciliation_ai", "month", f.start + 3600), "quote_expired"); // future
    await rejects(billing.applyChange(actor, "reconciliation_ai", "month", f.start - 3600), "quote_expired"); // stale
    await rejects(billing.applyChange(actor, "reconciliation_ai", "month", Number.NaN), "quote_expired");
    expect((await org(f)).plan, "nothing changed").toBe("reconciliation");
    expect(await paidTotal(f), "nothing charged").toBe(priceCents("reconciliation", "month"));
  });

  it("S-15: a double-click on an upgrade charges once", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "month");
    const quote = await billing.quoteChange(actor, "reconciliation_ai", "month");
    const results = await Promise.allSettled([
      billing.applyChange(actor, "reconciliation_ai", "month", quote.prorationDate),
      billing.applyChange(actor, "reconciliation_ai", "month", quote.prorationDate),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const second = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((second.reason as { code?: string }).code, "the second click found it already done").toBe("same_plan");
    const updates = (await invoicesOf(f)).filter((i) => i.billing_reason === "subscription_update");
    expect(updates).toHaveLength(1);
  });

  it("S-16: a lost webhook is repaired by the return-route re-sync", async () => {
    const f = await fixture();
    await subscribe(f, "reconciliation", "month");
    // Simulate a lost webhook: our copy never heard about the subscription's latest status.
    await setBillingCopy(f.orgId, { stripeStatus: null, syncedAt: null });
    expect((await org(f)).stripeStatus).toBeNull();

    expect(await refreshOrgBilling(f.orgId, "return")).toBe(true);
    expect((await org(f)).stripeStatus).toBe("active");
  });

  it("S-17: a card that needs 3-D Secure leaves the plan unchanged, sends the admin to authenticate", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "month");
    await setDefaultCard(f.customerId, "pm_card_authenticationRequired");
    const quote = await billing.quoteChange(actor, "reconciliation_ai", "month");
    const r = await billing.applyChange(actor, "reconciliation_ai", "month", quote.prorationDate);
    expect(r.result).toBe("payment_needed");
    expect((await org(f)).plan).toBe("reconciliation");
    expect(await paidTotal(f)).toBe(priceCents("reconciliation", "month"));
  });

  it("S-18: end plan now voids the unpaid invoice; never charged later", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "month");
    const periodEnd = (await org(f)).currentPeriodEnd!.getTime();
    await setDefaultCard(f.customerId, "pm_card_chargeCustomerFail");
    await advance(f, periodEnd / 1000 + 2 * 3600);
    expect((await org(f)).stripeStatus).toBe("past_due");
    await rejects(billing.cancelAtPeriodEnd(actor), "payment_failed");

    await billing.endPlanNow(actor);
    const row = await org(f);
    expect(row.subscriptionStatus).toBe("cancelled");
    expect((await access(f)).paid).toBe(false);
    expect((await invoicesOf(f)).filter((i) => i.status === "open"), "nothing left to retry").toEqual([]);

    // Their card starts working: Stripe must not collect anything.
    await setDefaultCard(f.customerId, "pm_card_visa");
    await advance(f, periodEnd / 1000 + 10 * DAY);
    expect(await paidTotal(f), "only the one month they had").toBe(priceCents("reconciliation", "month"));
  });

  it("S-19: checkout is refused while a first payment is still processing (incomplete)", async () => {
    const f = await fixture();
    await s.subscriptions.create({
      customer: f.customerId,
      items: [{ price: (await price("reconciliation", "month")).id }],
      payment_behavior: "default_incomplete",
    });
    await rejects(billing.startCheckout(actorOf(f), "reconciliation", "month"), "payment_processing");
  });

  it("S-20: mixed downgrade AI monthly to Reconciliation yearly waits for the month, then charges the year now (phase_start)", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation_ai", "month");
    const periodEnd = (await org(f)).currentPeriodEnd!.getTime();
    const quote = await billing.quoteChange(actor, "reconciliation", "year");
    expect(quote.change).toBe("at_period_end");
    expect(quote.dueTodayCents).toBe(0);
    await billing.applyChange(actor, "reconciliation", "year", 0);
    expect((await access(f)).ai, "AI kept for the paid month").toBe(true);

    await advance(f, periodEnd / 1000 + 2 * 3600);
    const row = await org(f);
    expect(row.plan).toBe("reconciliation");
    expect(row.billingInterval).toBe("year");
    expect((await invoicesOf(f))[0].amount_paid, "the year is charged in full when it starts, not deferred").toBe(priceCents("reconciliation", "year"));
    expect(await paidTotal(f)).toBe(priceCents("reconciliation_ai", "month") + priceCents("reconciliation", "year"));
    await assertPaidThrough(f);
    expect(await pendingItems(f)).toEqual([]);
  });

  it("S-21: after a downgrade has happened, upgrading and downgrading again both work", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation_ai", "month");
    const firstEnd = (await org(f)).currentPeriodEnd!.getTime();
    await billing.applyChange(actor, "reconciliation", "month", 0);
    await advance(f, firstEnd / 1000 + 2 * 3600);
    expect((await org(f)).plan).toBe("reconciliation");
    expect((await org(f)).pendingPlan, "nothing queued, though the old schedule may still be attached").toBeNull();

    const quote = await billing.quoteChange(actor, "reconciliation_ai", "month");
    expect(quote.change).toBe("now");
    expect(await billing.applyChange(actor, "reconciliation_ai", "month", quote.prorationDate)).toEqual({ result: "changed" });
    expect((await org(f)).plan).toBe("reconciliation_ai");
    expect(await paidTotal(f)).toBe(priceCents("reconciliation_ai", "month") + priceCents("reconciliation", "month") + quote.dueTodayCents);
    await assertPaidThrough(f);

    await billing.applyChange(actor, "reconciliation", "month", 0);
    expect((await org(f)).pendingPlan).toBe("reconciliation");
    expect(await pendingItems(f)).toEqual([]);
  });

  it("S-22: resume also undoes a cancellation date set from the Stripe dashboard", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    const sub = await subscribe(f, "reconciliation", "month");
    await s.subscriptions.update(sub.id, { cancel_at: sub.items.data[0].current_period_end });
    await syncOrgBilling(f.customerId);
    expect((await org(f)).cancelAtPeriodEnd).toBe(true);
    await billing.resume(actor);
    expect((await org(f)).cancelAtPeriodEnd).toBe(false);
    const after = await s.subscriptions.retrieve(sub.id);
    expect(after.cancel_at).toBeNull();
  });

  it("S-23: retries exhausted ends access (UNSURE: could not confirm the sandbox's dashboard retry rule cancels; simulated)", async () => {
    const f = await fixture();
    await subscribe(f, "reconciliation", "month");
    const periodEnd = (await org(f)).currentPeriodEnd!.getTime();
    await setDefaultCard(f.customerId, "pm_card_chargeCustomerFail");
    await advance(f, periodEnd / 1000 + 2 * 3600);
    expect((await org(f)).stripeStatus).toBe("past_due");

    // Not proven here: whether the sandbox account's Smart Retries rule set actually cancels a
    // subscription after retries are exhausted — that is a Stripe Dashboard setting this suite
    // cannot read or set from the API, and advancing the clock through the full retry schedule
    // (weeks) is impractical within this test's budget. Simulated instead, exactly as the task
    // allows: cancel directly in Stripe (what "retries exhausted" ends in) and prove the app's
    // sync correctly turns that into lost access.
    await s.subscriptions.cancel((await currentSub(f)).id);
    await syncOrgBilling(f.customerId);
    const row = await org(f);
    expect(row.subscriptionStatus).toBe("cancelled");
    expect((await access(f)).paid).toBe(false);
  });

  it("S-27: downgrade or checkout to Reconciliation refused with two active funding sources (P24); the queued downgrade in the copy", async () => {
    const f = await fixture(); // already has 1 funding source from createTestOrg
    const actor = actorOf(f);
    await addFundingSource(f.orgId); // now 2 active sources

    await rejects(billing.startCheckout(actor, "reconciliation", "month"), "too_many_sources");
    await subscribe(f, "reconciliation_ai", "month");
    await rejects(billing.quoteChange(actor, "reconciliation", "month"), "too_many_sources");
    await rejects(billing.applyChange(actor, "reconciliation", "month", 0), "too_many_sources");
    expect((await currentSub(f)).schedule, "refused before any schedule exists").toBeNull();
    expect((await org(f)).pendingPlan).toBeNull();

    // A single-source org can queue the same downgrade normally, and the copy the source limit
    // reads (P24) says when it starts.
    const g = await fixture();
    const gActor = actorOf(g);
    await subscribe(g, "reconciliation_ai", "month");
    const periodEnd = (await org(g)).currentPeriodEnd!.getTime();
    await billing.applyChange(gActor, "reconciliation", "month", 0);
    const queued = await org(g);
    expect(queued).toMatchObject({ pendingPlan: "reconciliation", pendingReason: "downgrade" });
    expect(queued.pendingAt!.getTime()).toBe(periodEnd);

    await billing.cancelPendingChange(gActor);
    expect((await org(g)).pendingPlan).toBeNull();
  });

  it("S-29: planPriceMoves — dry run changes nothing and lists skipped; a real run applies at next renewal; a queued downgrade is rewritten; cancelling keeps the price move", async () => {
    const active = await price("reconciliation", "month");

    // (a) dry run: a stale price on an otherwise ordinary subscription is reported, nothing moves.
    const dry = await fixture();
    const staleA = await throwawayPrice("reconciliation", "month", active.unit_amount! - 500);
    const subA = await subscribeToPrice(dry, staleA.id);
    const dryReport = await billing.planPriceMoves({ apply: false });
    const dryEntry = dryReport.moved.find((m) => m.orgId === dry.orgId);
    expect(dryEntry).toMatchObject({ fromPriceId: staleA.id, toPriceId: active.id });
    expect(dryReport.skipped.some((sk) => sk.orgId === dry.orgId)).toBe(false);
    expect((await s.subscriptions.retrieve(subA.id)).items.data[0].price.id, "dry run touches nothing").toBe(staleA.id);
    expect((await s.subscriptions.retrieve(subA.id)).schedule).toBeNull();

    // (b) skipped: a stale price with an upgrade awaiting payment.
    const pend = await fixture();
    const stalePend = await throwawayPrice("reconciliation", "month", active.unit_amount! - 500);
    await subscribeToPrice(pend, stalePend.id);
    await setDefaultCard(pend.customerId, "pm_card_chargeCustomerFail");
    const pendActor = actorOf(pend);
    const pendQuote = await billing.quoteChange(pendActor, "reconciliation_ai", "month");
    await billing.applyChange(pendActor, "reconciliation_ai", "month", pendQuote.prorationDate); // leaves pending_update
    const pendReport = await billing.planPriceMoves({ apply: false });
    expect(pendReport.skipped.find((sk) => sk.orgId === pend.orgId)?.reason).toMatch(/awaiting payment/);

    // (c) skipped: a stale price on a cancelling subscription.
    const canc = await fixture();
    const staleCanc = await throwawayPrice("reconciliation", "month", active.unit_amount! - 500);
    await subscribeToPrice(canc, staleCanc.id);
    await billing.cancelAtPeriodEnd(actorOf(canc));
    const cancReport = await billing.planPriceMoves({ apply: false });
    expect(cancReport.skipped.find((sk) => sk.orgId === canc.orgId)?.reason).toBe("cancelling");

    // (d) a real run creates a schedule (price move), charges nothing today, and the price only
    // moves at the next renewal — never deferred, never charged twice.
    const real = await fixture();
    const staleReal = await throwawayPrice("reconciliation", "month", active.unit_amount! - 500);
    const subReal = await subscribeToPrice(real, staleReal.id);
    const periodEnd = (await currentSub(real)).items.data[0].current_period_end;
    const realReport = await billing.planPriceMoves({ apply: true });
    expect(realReport.moved.some((m) => m.orgId === real.orgId)).toBe(true);
    const afterApply = await s.subscriptions.retrieve(subReal.id, { expand: ["schedule.phases.items.price"] });
    expect(afterApply.items.data[0].price.id, "unchanged today").toBe(staleReal.id);
    const schedule = afterApply.schedule as Stripe.SubscriptionSchedule;
    expect(schedule).not.toBeNull();
    const future = schedule.phases.find((p) => p.start_date >= schedule.current_phase!.end_date)!;
    const futurePrice = future.items[0]?.price as Stripe.Price;
    expect(futurePrice.id).toBe(active.id);
    expect(future.metadata?.reason).toBe("price_move");

    await advance(real, periodEnd + 2 * 3600);
    const invoiceAfterMove = (await invoicesOf(real))[0];
    expect(invoiceAfterMove.amount_paid, "the real active price, applied at renewal").toBe(priceCents("reconciliation", "month"));
    await assertPaidThrough(real);

    // (e) a queued downgrade whose target price has since gone stale is rewritten in place, kept
    // as a downgrade (not a price move) — proven by a stale current price alongside it, the only
    // shape `planPriceMoves` will revisit a schedule for.
    const queued = await fixture();
    const staleAi = await throwawayPrice("reconciliation_ai", "month", 100_00);
    const staleRecon = await throwawayPrice("reconciliation", "month", 50_00);
    const subQueued = await subscribeToPrice(queued, staleAi.id);
    await queuePhase(subQueued, staleRecon); // no reason metadata → an ordinary downgrade
    await billing.planPriceMoves({ apply: true });
    const afterRewrite = await s.subscriptions.retrieve(subQueued.id, { expand: ["schedule.phases.items.price"] });
    const rewrittenSchedule = afterRewrite.schedule as Stripe.SubscriptionSchedule;
    const rewrittenFuture = rewrittenSchedule.phases.find((p) => p.start_date >= rewrittenSchedule.current_phase!.end_date)!;
    const activeRecon = await price("reconciliation", "month");
    expect((rewrittenFuture.items[0]?.price as Stripe.Price).id, "queued downgrade rewritten to the active price").toBe(activeRecon.id);
    expect(rewrittenFuture.metadata?.reason, "still a downgrade, not a price move").not.toBe("price_move");

    // (f) cancelling a queued change while the current price is itself stale keeps a schedule —
    // retagged as a price move to the current plan's active price — rather than releasing it and
    // stranding the subscriber on the stale price.
    const cancelQueued = await fixture();
    const staleAi2 = await throwawayPrice("reconciliation_ai", "month", 100_00);
    const subCancelQueued = await subscribeToPrice(cancelQueued, staleAi2.id);
    const activeMonth = await price("reconciliation", "month");
    await queuePhase(subCancelQueued, activeMonth); // an ordinary queued downgrade
    await billing.cancelPendingChange(actorOf(cancelQueued));
    const afterCancel = await s.subscriptions.retrieve(subCancelQueued.id, { expand: ["schedule.phases.items.price"] });
    expect(afterCancel.schedule, "a schedule remains").not.toBeNull();
    const cancelSchedule = afterCancel.schedule as Stripe.SubscriptionSchedule;
    const cancelFuture = cancelSchedule.phases.find((p) => p.start_date >= cancelSchedule.current_phase!.end_date)!;
    const activeAi = await price("reconciliation_ai", "month");
    expect((cancelFuture.items[0]?.price as Stripe.Price).id, "moves to the current plan's active price").toBe(activeAi.id);
    expect(cancelFuture.metadata?.reason).toBe("price_move");
    expect((await org(cancelQueued)).pendingReason, "a price move is not a downgrade").toBe("price_move");
  });

  it("S-30: setCollectionPaused(true) pauses collection, false resumes it — with a queued downgrade too", async () => {
    const f = await fixture();
    const actor = actorOf(f);
    await subscribe(f, "reconciliation", "month");

    await billing.setCollectionPaused(f.orgId, true);
    let sub = await currentSub(f);
    expect(sub.pause_collection).toMatchObject({ behavior: "void" });
    expect((await org(f)).collectionPaused).toBe(true);

    await billing.setCollectionPaused(f.orgId, false);
    sub = await currentSub(f);
    expect(sub.pause_collection).toBeNull();
    expect((await org(f)).collectionPaused).toBe(false);

    // Same, alongside a queued downgrade: pausing/resuming collection must not disturb it.
    await billing.applyChange(actor, "reconciliation_ai", "month", (await billing.quoteChange(actor, "reconciliation_ai", "month")).prorationDate);
    await billing.applyChange(actor, "reconciliation", "month", 0); // queued downgrade
    await billing.setCollectionPaused(f.orgId, true);
    sub = await currentSub(f);
    expect(sub.pause_collection).toMatchObject({ behavior: "void" });
    expect(sub.schedule, "the queued downgrade survives a pause").not.toBeNull();
    await billing.setCollectionPaused(f.orgId, false);
    expect((await currentSub(f)).pause_collection).toBeNull();
  });

  it("I-17: the Stripe customer's email follows the acting admin after a billing action", async () => {
    const f = await fixture();
    const first = actorOf(f, `first-${randomUUID()}@example.com`);
    await billing.startCheckout(first, "reconciliation", "month");
    expect((await s.customers.retrieve(f.customerId) as Stripe.Customer).email).toBe(first.email);

    await subscribe(f, "reconciliation", "month");
    const second = actorOf(f, `second-${randomUUID()}@example.com`);
    await billing.cancelAtPeriodEnd(second);
    expect((await s.customers.retrieve(f.customerId) as Stripe.Customer).email).toBe(second.email);
  });

  it("portalUrl: a Stripe-hosted URL for a paying org; refused for an org with no plan", async () => {
    // A genuinely unpaid org (never through `fixture()`, which already creates a Stripe customer
    // for its card-charging tests) — portalUrl's `no_plan` guard is "no Stripe customer id at
    // all", not "no live subscription".
    const { orgId } = await createTestOrg({ name: `Billing ${randomUUID()}`, complimentary: false });
    orgIds.push(orgId);
    await rejects(billing.portalUrl({ orgId, email: `t-${randomUUID()}@example.com` }), "no_plan");

    const f = await fixture();
    await subscribe(f, "reconciliation", "month");
    const url = await billing.portalUrl(actorOf(f));
    expect(url).toMatch(/^https:\/\/billing\.stripe\.com\//);
  });
});

/**
 * S-28 runs in isolation, on purpose: proving "a price change never touches an existing
 * subscriber" the most faithfully would mean moving the real `sf360_*` lookup key that the
 * WHOLE concurrent suite above resolves prices through (`price()`/`findPrice`) — every other
 * test in this file would see whichever price briefly held the key while this one runs. Rather
 * than risk that, it uses a throwaway product+price (allowed by the task: "use a separate
 * throwaway product+price and exercise planPriceMoves logic accordingly"), so it is safe to run
 * concurrently too — but it is kept in its own non-concurrent block and should still be run with
 * `npx vitest run -c vitest.stripe.config.mts -t "S-28"` if ever isolating it matters, since nothing
 * here actually depends on file-level isolation once the real lookup key is never touched.
 */
describe("billing against the Stripe sandbox: S-28 (throwaway product/price, real lookup keys never moved)", () => {
  it("S-28: a new subscriber pays the new price; an existing subscriber renews at the old one", async () => {
    const before = await price("reconciliation", "month");

    const product = await s.products.create({ name: `sf360 test S-28 ${randomUUID()}` });
    throwawayProducts.push(product.id);
    const oldPrice = await s.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: 10_000,
      recurring: { interval: "month" },
      metadata: { plan: "reconciliation" },
    });

    const existing = await fixture();
    const existingSub = await subscribeToPrice(existing, oldPrice.id);

    // "The price changes": a new Price on the same product, the old one retired — never touching
    // pricing.ts's real sf360_reconciliation_month lookup key.
    const newPrice = await s.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: 12_000,
      recurring: { interval: "month" },
      metadata: { plan: "reconciliation" },
    });
    await s.prices.update(oldPrice.id, { active: false });

    const fresh = await fixture();
    const freshSub = await subscribeToPrice(fresh, newPrice.id);
    expect(freshSub.items.data[0].price.id).toBe(newPrice.id);
    expect((await invoicesOf(fresh))[0].amount_paid).toBe(12_000);

    // The existing subscriber is entirely unaffected: Stripe never reprices a live subscription
    // on its own, which is exactly what the app relies on to defer a price move to the next
    // renewal via `planPriceMoves` (S-29) rather than something happening automatically.
    expect((await s.subscriptions.retrieve(existingSub.id)).items.data[0].price.id).toBe(oldPrice.id);
    await advance(existing, (await currentSub(existing)).items.data[0].current_period_end + 2 * 3600);
    expect((await invoicesOf(existing))[0].amount_paid, "renews at the old price").toBe(10_000);

    // And the real sf360_* lookup key was never touched.
    expect((await price("reconciliation", "month")).id).toBe(before.id);
  });
});
