/**
 * Billing against the REAL Stripe sandbox, with test clocks to fast-forward time (Phase 15 §8.3).
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
import { orgAccountEvents, organizations } from "@/src/db/schema";
import { createTestOrg } from "@/src/db/test-org";
import { lookupKey, priceCents } from "@/src/modules/billing/pricing";
import { INTERVALS, type Interval, type PlanId } from "@/src/modules/billing/rules";
import { stripe } from "@/src/modules/billing/stripe";
import { flagDispute, syncOrgBilling } from "@/src/modules/billing/sync";
import { handleWebhook } from "@/src/modules/billing/webhook";

const s = stripe();
const clocks: string[] = [];
const orgIds: string[] = [];

afterAll(async () => {
  await Promise.allSettled(clocks.map((id) => s.testHelpers.testClocks.del(id)));
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
  await db.update(organizations).set({ stripeCustomerId: customer.id, stripeLivemode: false }).where(eq(organizations.id, orgId));
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

async function org(f: Fixture) {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, f.orgId));
  return row;
}

async function history(f: Fixture) {
  return db.select().from(orgAccountEvents).where(eq(orgAccountEvents.orgId, f.orgId));
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
    expect({ ...thrice, billingSyncedAt: null, updatedAt: null }).toEqual({ ...once, billingSyncedAt: null, updatedAt: null });

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
    await db.update(organizations).set({ stripeStatus: null }).where(eq(organizations.id, f.orgId));

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
    await db.update(organizations).set({ stripeLivemode: true, stripeStatus: null }).where(eq(organizations.id, f.orgId));
    expect(await syncOrgBilling(f.customerId)).toBe("unknown_customer");
    expect((await org(f)).stripeStatus).toBeNull();
  });
});
