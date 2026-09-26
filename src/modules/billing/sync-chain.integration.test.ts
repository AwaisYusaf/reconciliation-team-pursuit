/**
 * The path a Stripe charge takes into the database, end to end except for Stripe itself: a signed
 * webhook POST, `handleWebhook`, `syncOrgBilling`, and the `org_billing` row (Phase 16, D-125).
 * Plus the two guards that keep that copy right when syncs overlap: a Stripe read that started
 * earlier never overwrites one that started later, and news about a replaced customer is dropped.
 *
 * Only Stripe's API is mocked. The in-process lock is mocked to pass through, which is what it is
 * between the webhook route, the app and the nightly reconcile: each has its own copy.
 */
import { config } from "dotenv";
import Stripe from "stripe";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const subscriptionsOfMock = vi.fn();

vi.mock("@/src/modules/billing/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/src/modules/billing/stripe")>("@/src/modules/billing/stripe");
  return {
    ...actual,
    subscriptionsOf: (...args: unknown[]) => subscriptionsOfMock(...args),
    stripe: () => {
      throw new Error("no other Stripe call expected in this suite");
    },
  };
});
vi.mock("@/src/modules/billing/lock", () => ({
  withLock: (_key: string, fn: () => Promise<unknown>) => fn(),
}));

config({ path: ".env.local", quiet: true });

const hasDatabase = Boolean(process.env.DATABASE_URL);

function fakeSub(opts: { status: string; plan?: string; interval?: string; currentPeriodEnd?: number }): Stripe.Subscription {
  return {
    id: "sub_chain",
    status: opts.status,
    created: 1_600_000_000,
    cancel_at_period_end: false,
    cancel_at: null,
    pause_collection: null,
    schedule: null,
    pending_update: null,
    latest_invoice: null,
    items: {
      data: [
        {
          price: { id: "price_chain", metadata: { plan: opts.plan ?? "reconciliation" }, recurring: { interval: opts.interval ?? "month" } },
          current_period_end: opts.currentPeriodEnd ?? 1_700_000_000,
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

describe.skipIf(!hasDatabase)("a Stripe charge reaches org_billing (integration, Phase 16)", async () => {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/src/db");
  const { organizations, orgAccountEvents } = await import("@/src/db/schema");
  const { createTestOrg, orgWithBilling, setBillingCopy } = await import("@/src/db/test-org");
  const { syncOrgBilling } = await import("./sync");
  const { POST } = await import("@/app/api/stripe/webhook/route");

  const orgIds: string[] = [];
  let counter = 0;

  async function orgWithCustomer() {
    counter += 1;
    const { orgId } = await createTestOrg({ name: `Sync Chain ${Date.now()}-${counter}`, complimentary: false });
    orgIds.push(orgId);
    const customerId = `cus_chain_${Date.now()}_${counter}`;
    await setBillingCopy(orgId, { stripeCustomerId: customerId, livemode: false });
    return { orgId, customerId };
  }

  beforeEach(() => {
    subscriptionsOfMock.mockReset();
    vi.stubEnv("BILLING_ENABLED", "true");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_chain");
    vi.stubEnv("STRIPE_SECRET_KEY", ""); // test mode
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
  });

  it("a signed invoice.paid webhook for a monthly renewal updates the org's copy", async () => {
    const { orgId, customerId } = await orgWithCustomer();
    subscriptionsOfMock.mockResolvedValue([
      fakeSub({ status: "active", plan: "reconciliation", interval: "month", currentPeriodEnd: 1_760_000_000 }),
    ]);

    const body = JSON.stringify({
      id: "evt_chain",
      object: "event",
      livemode: false,
      type: "invoice.paid",
      data: { object: { customer: customerId } },
    });
    const signature = new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload: body, secret: "whsec_chain" });
    const response = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        body,
        headers: { "stripe-signature": signature, "content-length": String(Buffer.byteLength(body)) },
      }),
    );

    expect(response.status).toBe(200);
    expect(await orgWithBilling(orgId)).toMatchObject({
      stripeStatus: "active",
      billingInterval: "month",
      currentPeriodEnd: new Date(1_760_000_000 * 1000),
      subscriptionStatus: "active",
    });
  });

  it("a Stripe read that started earlier but finishes last never overwrites a later one", async () => {
    const { orgId, customerId } = await orgWithCustomer();
    subscriptionsOfMock
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return [fakeSub({ status: "trialing", plan: "reconciliation" })];
      })
      .mockImplementationOnce(async () => [fakeSub({ status: "active", plan: "reconciliation_ai" })]);

    const older = syncOrgBilling(customerId);
    await new Promise((resolve) => setTimeout(resolve, 10)); // the newer read starts strictly later
    const newer = syncOrgBilling(customerId);
    await Promise.all([older, newer]);

    expect(await orgWithBilling(orgId)).toMatchObject({ stripeStatus: "active", plan: "reconciliation_ai" });
  });

  it("news about a customer that was replaced while Stripe was being read is dropped", async () => {
    const { orgId, customerId } = await orgWithCustomer();
    subscriptionsOfMock.mockImplementationOnce(async () => {
      await setBillingCopy(orgId, { stripeCustomerId: `${customerId}_new` });
      return [fakeSub({ status: "active", plan: "reconciliation_ai" })];
    });

    await syncOrgBilling(customerId);

    expect(await orgWithBilling(orgId)).toMatchObject({
      stripeCustomerId: `${customerId}_new`,
      stripeStatus: null,
      plan: "reconciliation",
    });
    expect(await db.select().from(orgAccountEvents).where(eq(orgAccountEvents.orgId, orgId))).toHaveLength(0);
  });
});
