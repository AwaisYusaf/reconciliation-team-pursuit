/**
 * `syncOrgBilling`, `refreshOrgBilling` and `flagDispute` against real Postgres (Phase 16, P1,
 * P13, §2.6). `@/src/modules/billing/stripe` is mocked so no real Stripe call happens — only
 * `subscriptionsOf` and `stripe()` (for `flagDispute`'s `charges.retrieve`) are exercised, with
 * fake `Stripe.Subscription`/`Stripe.Charge` shapes the same way `copy.test.ts` builds them.
 * Follows `src/modules/admin/actions.integration.test.ts`'s pattern: `vi.mock` before the dotenv
 * config, dynamic imports inside `describe.skipIf(!hasDatabase)` so nothing loads without a
 * database.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";
import type Stripe from "stripe";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const subscriptionsOfMock = vi.fn();
const chargesRetrieveMock = vi.fn();
const stripeClientMock = { charges: { retrieve: chargesRetrieveMock } };

vi.mock("@/src/modules/billing/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/src/modules/billing/stripe")>("@/src/modules/billing/stripe");
  return {
    subscriptionsOf: subscriptionsOfMock,
    stripe: () => stripeClientMock,
    idOf: actual.idOf,
    isMissing: actual.isMissing,
    futurePhase: vi.fn(),
  };
});

config({ path: ".env.local", quiet: true });

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("billing sync (integration, Phase 16)", async () => {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/src/db");
  const { organizations, orgAccountEvents, fundingSources } = await import("@/src/db/schema");
  const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");
  const { createTestOrg, orgWithBilling, setBillingCopy } = await import("@/src/db/test-org");
  const { entitlementOf } = await import("@/src/services/auth/entitlement");
  const { todayIso } = await import("@/src/domain/dates");
  const { syncOrgBilling, refreshOrgBilling, clearRefreshThrottle, flagDispute } = await import("./sync");
  const { stripeKeyIsLive } = await import("./config");

  // Real Stripe calls must be impossible even if the mock above is somehow bypassed.
  if (stripeKeyIsLive()) throw new Error("refuse to run this suite against a live-looking Stripe key");

  let counter = 0;
  const orgIds: string[] = [];

  async function freshOrg(overrides: { complimentary?: boolean } = {}) {
    counter += 1;
    const { orgId } = await createTestOrg({ name: `Billing Sync Org ${Date.now()}-${counter}`, ...overrides });
    orgIds.push(orgId);
    return orgId;
  }

  /** Sets a Stripe customer on the org, our mode, so `findOrgByCustomer` will find it. */
  async function withCustomer(orgId: string, customerId: string, livemode = false) {
    await setBillingCopy(orgId, { stripeCustomerId: customerId, livemode });
  }

  /** The org row with its `org_billing` copy spread over it. */
  async function orgRow(orgId: string) {
    return orgWithBilling(orgId);
  }

  async function eventsFor(orgId: string) {
    return db.select().from(orgAccountEvents).where(eq(orgAccountEvents.orgId, orgId)).orderBy(orgAccountEvents.createdAt);
  }

  function uniqueCustomerId() {
    counter += 1;
    return `cus_sync_test_${Date.now()}_${counter}`;
  }

  type FakeSubOpts = {
    id?: string;
    status?: string;
    created?: number;
    plan?: string;
    interval?: string;
    currentPeriodEnd?: number;
  };
  function fakeSub(opts: FakeSubOpts = {}): Stripe.Subscription {
    return {
      id: opts.id ?? "sub_1",
      status: opts.status ?? "active",
      created: opts.created ?? 1_600_000_000,
      cancel_at_period_end: false,
      cancel_at: null,
      pause_collection: null,
      schedule: null,
      pending_update: null,
      latest_invoice: null,
      items: {
        data: [
          {
            price: { id: "price_1", metadata: { plan: opts.plan ?? "reconciliation" }, recurring: { interval: opts.interval ?? "month" } },
            current_period_end: opts.currentPeriodEnd ?? 1_700_000_000,
          },
        ],
      },
    } as unknown as Stripe.Subscription;
  }

  beforeEach(() => {
    subscriptionsOfMock.mockReset();
    chargesRetrieveMock.mockReset();
    clearRefreshThrottle();
  });

  // Even when a test fails midway, its env stubs and console spies don't reach the next one.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
  });

  describe("a plan bought during complimentary access, charged today (D-128)", () => {
    const marked = (status: string, created: number) =>
      ({ ...fakeSub({ status, created, plan: "reconciliation" }), metadata: { endComplimentary: "on_payment" } }) as Stripe.Subscription;

    async function compOrgWithCustomer(grantAt: Date | null, until: string | null = null) {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      await db
        .update(organizations)
        .set({ complimentary: true, complimentaryUntil: until, complimentaryPlan: "reconciliation_ai" })
        .where(eq(organizations.id, orgId));
      if (grantAt) {
        const snap = { plan: "reconciliation" as const, status: "active" as const, complimentary: true, complimentaryUntil: null, suspended: false };
        await db.insert(orgAccountEvents).values({ orgId, action: "complimentary_granted", before: snap, after: snap, createdAt: grantAt });
      }
      return { orgId, customerId };
    }

    it("once paid, the free access granted before it ends, recorded as Stripe", async () => {
      const created = Math.floor(Date.now() / 1000);
      const { orgId, customerId } = await compOrgWithCustomer(new Date((created - 86_400) * 1000));
      subscriptionsOfMock.mockResolvedValue([marked("active", created)]);
      await syncOrgBilling(customerId);
      const row = await orgRow(orgId);
      expect(row.complimentary).toBe(false);
      expect(row.complimentaryUntil).toBeNull();
      expect(row.complimentaryPlan).toBeNull();
      expect(row.plan).toBe("reconciliation");
      const removed = (await eventsFor(orgId)).filter((e) => e.action === "complimentary_removed");
      expect(removed).toHaveLength(1);
      expect(removed[0]).toMatchObject({ viaStripe: true, actorStaffId: null });
    });

    it("a grant with an end date still ahead ends the same way", async () => {
      const created = Math.floor(Date.now() / 1000);
      const until = todayIso(new Date(Date.now() + 60 * 86_400_000));
      const { orgId, customerId } = await compOrgWithCustomer(new Date((created - 86_400) * 1000), until);
      subscriptionsOfMock.mockResolvedValue([marked("active", created)]);
      await syncOrgBilling(customerId);
      const row = await orgRow(orgId);
      expect(row.complimentary).toBe(false);
      expect(row.complimentaryUntil).toBeNull();
    });

    it("a grant with no History row (older data) also ends", async () => {
      const { orgId, customerId } = await compOrgWithCustomer(null);
      subscriptionsOfMock.mockResolvedValue([marked("active", Math.floor(Date.now() / 1000))]);
      await syncOrgBilling(customerId);
      expect((await orgRow(orgId)).complimentary).toBe(false);
    });

    it("a staff grant made after the subscription is never undone by it", async () => {
      const created = Math.floor(Date.now() / 1000) - 7 * 86_400;
      const { orgId, customerId } = await compOrgWithCustomer(new Date());
      subscriptionsOfMock.mockResolvedValue([marked("active", created)]);
      await syncOrgBilling(customerId);
      const row = await orgRow(orgId);
      expect(row.complimentary).toBe(true);
      expect(row.complimentaryPlan).toBe("reconciliation_ai");
    });

    it("not paid yet (incomplete): the free access stays", async () => {
      const { orgId, customerId } = await compOrgWithCustomer(null);
      subscriptionsOfMock.mockResolvedValue([marked("incomplete", Math.floor(Date.now() / 1000))]);
      await syncOrgBilling(customerId);
      expect((await orgRow(orgId)).complimentary).toBe(true);
    });

    it("syncing twice ends it once: one History row", async () => {
      const { orgId, customerId } = await compOrgWithCustomer(null);
      subscriptionsOfMock.mockResolvedValue([marked("active", Math.floor(Date.now() / 1000))]);
      await syncOrgBilling(customerId);
      await syncOrgBilling(customerId);
      expect((await eventsFor(orgId)).filter((e) => e.action === "complimentary_removed")).toHaveLength(1);
    });
  });

  describe("D-129: once Reconciliation is paid, the source chosen at Checkout is kept and the others archived", () => {
    const paidSub = (opts: { status?: string; plan?: string; keep?: string | null; created?: number }) =>
      ({
        ...fakeSub({ status: opts.status ?? "active", plan: opts.plan ?? "reconciliation", created: opts.created }),
        metadata: { endComplimentary: "on_payment", ...(opts.keep ? { keepFundingSource: opts.keep } : {}) },
      }) as Stripe.Subscription;

    /** An org with a Stripe customer and `extra` more active sources than the one it starts with. */
    async function orgWithSources(extra: number) {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      for (let i = 0; i < extra; i++) await addSource(orgId);
      return { orgId, customerId, ids: await sourceIds(orgId) };
    }

    async function addSource(orgId: string) {
      counter += 1;
      const [row] = await db
        .insert(fundingSources)
        .values({ orgId, name: `Sync Source ${counter}`, type: "grant", sortOrder: counter, ...ORIGINAL_RULES })
        .returning({ id: fundingSources.id });
      return row.id;
    }

    /** Every source of the org in the picker's order, with whether it is archived. */
    async function sourceIds(orgId: string) {
      const { listFundingSources } = await import("@/src/modules/funding-sources/queries");
      return (await listFundingSources(orgId)).map((source) => source.id);
    }
    async function activeIds(orgId: string) {
      const { listFundingSources } = await import("@/src/modules/funding-sources/queries");
      return (await listFundingSources(orgId)).filter((source) => source.archivedAt === null).map((source) => source.id);
    }
    async function headerSelection(orgId: string) {
      const [row] = await db
        .select({ id: organizations.activeFundingSourceId })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      return row.id;
    }

    it("the first paid sync keeps the chosen source, archives the others and clears a header selection on one of them; a later sync archives nothing", async () => {
      const { orgId, customerId, ids } = await orgWithSources(2);
      const [, kept, third] = ids;
      await db.update(organizations).set({ activeFundingSourceId: third }).where(eq(organizations.id, orgId));
      // Another org's sources are never touched.
      const bystander = await orgWithSources(1);

      subscriptionsOfMock.mockResolvedValue([paidSub({ keep: kept })]);
      await syncOrgBilling(customerId);
      expect(await activeIds(orgId)).toEqual([kept]);
      expect(await headerSelection(orgId)).toBeNull();
      expect(await activeIds(bystander.orgId)).toEqual(bystander.ids);

      // A source added afterwards (billing switched off meanwhile, say) is not this Checkout's.
      const later = await addSource(orgId);
      await syncOrgBilling(customerId);
      expect(await activeIds(orgId)).toEqual([kept, later]);
    });

    it("a header selection on the kept source stays", async () => {
      const { orgId, customerId, ids } = await orgWithSources(1);
      await db.update(organizations).set({ activeFundingSourceId: ids[1] }).where(eq(organizations.id, orgId));
      subscriptionsOfMock.mockResolvedValue([paidSub({ keep: ids[1] })]);
      await syncOrgBilling(customerId);
      expect(await activeIds(orgId)).toEqual([ids[1]]);
      expect(await headerSelection(orgId)).toBe(ids[1]);
    });

    it("sources added while Checkout was open are archived once it is paid (B3: free Reconciliation + AI buying Reconciliation)", async () => {
      const { orgId, customerId, ids } = await orgWithSources(0);
      await db
        .update(organizations)
        .set({ complimentary: true, complimentaryPlan: "reconciliation_ai" })
        .where(eq(organizations.id, orgId));
      // Checkout opened with one source (recorded as the one to keep); two more added in another tab.
      await addSource(orgId);
      await addSource(orgId);
      subscriptionsOfMock.mockResolvedValue([paidSub({ keep: ids[0], created: Math.floor(Date.now() / 1000) })]);
      await syncOrgBilling(customerId);
      const row = await orgRow(orgId);
      expect(row.complimentary).toBe(false);
      expect(await activeIds(orgId)).toEqual([ids[0]]);
    });

    it("a kept source archived meanwhile: the first active one is kept instead, and a line is logged", async () => {
      const { orgId, customerId, ids } = await orgWithSources(2);
      await db.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, ids[1]));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      subscriptionsOfMock.mockResolvedValue([paidSub({ keep: ids[1] })]);
      await syncOrgBilling(customerId);
      expect(await activeIds(orgId)).toEqual([ids[0]]);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("no longer active"));
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("ALERT"));
    });

    it.each([
      ["Reconciliation + AI", { plan: "reconciliation_ai" }],
      ["not paid yet (incomplete)", { status: "incomplete" }],
      ["a trial, live but not charged yet", { status: "trialing" }],
      ["no source recorded (a subscription this build didn't open)", { keep: null }],
    ])("nothing is archived: %s", async (_case, opts) => {
      const { orgId, customerId, ids } = await orgWithSources(1);
      subscriptionsOfMock.mockResolvedValue([paidSub({ keep: ids[0], ...opts })]);
      await syncOrgBilling(customerId);
      expect(await activeIds(orgId)).toEqual(ids);
    });

    it("nothing is archived when the stored copy was already live (a renewal, a recovered payment)", async () => {
      const { orgId, customerId, ids } = await orgWithSources(1);
      await setBillingCopy(orgId, { stripeStatus: "past_due" });
      subscriptionsOfMock.mockResolvedValue([paidSub({ keep: ids[0] })]);
      await syncOrgBilling(customerId);
      expect(await activeIds(orgId)).toEqual(ids);
    });

    it("nothing is archived while a staff grant made after the subscription keeps the org on its free plan", async () => {
      const { orgId, customerId, ids } = await orgWithSources(1);
      await db
        .update(organizations)
        .set({ complimentary: true, complimentaryPlan: "reconciliation_ai" })
        .where(eq(organizations.id, orgId));
      const snap = { plan: "reconciliation" as const, status: "active" as const, complimentary: true, complimentaryUntil: null, suspended: false };
      await db.insert(orgAccountEvents).values({ orgId, action: "complimentary_granted", before: snap, after: snap, createdAt: new Date() });
      subscriptionsOfMock.mockResolvedValue([paidSub({ keep: ids[0], created: Math.floor(Date.now() / 1000) - 7 * 86_400 })]);
      await syncOrgBilling(customerId);
      expect((await orgRow(orgId)).complimentary).toBe(true);
      expect(await activeIds(orgId)).toEqual(ids);
    });
  });

  describe("unknown customer", () => {
    it("a customer id no org has: 'unknown_customer', zero Stripe calls", async () => {
      const result = await syncOrgBilling(uniqueCustomerId());
      expect(result).toBe("unknown_customer");
      expect(subscriptionsOfMock).not.toHaveBeenCalled();
    });

    it("a customer stored for the other Stripe mode is treated as absent: 'unknown_customer', zero Stripe calls", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId, /* livemode */ true); // our stripeKeyIsLive() is false in test mode
      const result = await syncOrgBilling(customerId);
      expect(result).toBe("unknown_customer");
      expect(subscriptionsOfMock).not.toHaveBeenCalled();
    });
  });

  describe("I-6: one History row per real change", () => {
    it("first sync to active writes exactly one row; a no-change re-sync writes none; a change to past_due writes a second", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);

      subscriptionsOfMock.mockResolvedValue([fakeSub({ status: "active", plan: "reconciliation_ai" })]);
      expect(await syncOrgBilling(customerId)).toBe("synced");

      const afterFirst = await orgRow(orgId);
      expect(afterFirst.plan).toBe("reconciliation_ai");
      expect(afterFirst.subscriptionStatus).toBe("active");
      // The copy itself, which is what access is decided from (D-125).
      expect(afterFirst).toMatchObject({
        stripeStatus: "active",
        billingInterval: "month",
        currentPeriodEnd: new Date(1_700_000_000 * 1000),
        cancelAtPeriodEnd: false,
      });
      expect(afterFirst.syncedAt).toBeInstanceOf(Date);

      let events = await eventsFor(orgId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: "plan_changed", viaStripe: true, actorStaffId: null });
      expect(events[0].before).toMatchObject({ plan: "reconciliation", status: "trial" });
      expect(events[0].after).toMatchObject({ plan: "reconciliation_ai", status: "active" });

      // Re-sync, nothing changed: no new row.
      await syncOrgBilling(customerId);
      events = await eventsFor(orgId);
      expect(events).toHaveLength(1);

      // A real change: active -> past_due writes a second row.
      subscriptionsOfMock.mockResolvedValue([fakeSub({ status: "past_due", plan: "reconciliation_ai" })]);
      await syncOrgBilling(customerId);
      const afterSecond = await orgRow(orgId);
      expect(afterSecond.subscriptionStatus).toBe("past_due");
      expect(afterSecond.stripeStatus).toBe("past_due");

      events = await eventsFor(orgId);
      expect(events).toHaveLength(2);
      expect(events[1].before).toMatchObject({ status: "active" });
      expect(events[1].after).toMatchObject({ status: "past_due" });
    });
  });

  describe("the copy follows Stripe: renewal, cancel at period end, cancellation", () => {
    it("a renewal moves the period end, a pending cancel is copied, and a cancelled plan ends access", async () => {
      vi.stubEnv("BILLING_ENABLED", "true");
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      const paid = async () => {
        const row = await orgRow(orgId);
        return entitlementOf({ ...row, stripeStatus: row.stripeStatus ?? null }).paid;
      };

      subscriptionsOfMock.mockResolvedValue([fakeSub({ status: "active", interval: "year", currentPeriodEnd: 1_700_000_000 })]);
      await syncOrgBilling(customerId);
      expect(await orgRow(orgId)).toMatchObject({ stripeStatus: "active", billingInterval: "year" });
      expect(await paid()).toBe(true);

      // Stripe charged the next period: the copy's period end moves with it.
      subscriptionsOfMock.mockResolvedValue([fakeSub({ status: "active", interval: "year", currentPeriodEnd: 1_731_536_000 })]);
      await syncOrgBilling(customerId);
      expect((await orgRow(orgId)).currentPeriodEnd).toEqual(new Date(1_731_536_000 * 1000));

      subscriptionsOfMock.mockResolvedValue([{ ...fakeSub({ status: "active", interval: "year", currentPeriodEnd: 1_731_536_000 }), cancel_at_period_end: true }]);
      await syncOrgBilling(customerId);
      expect((await orgRow(orgId)).cancelAtPeriodEnd).toBe(true);
      expect(await paid()).toBe(true); // still paid until the period ends

      subscriptionsOfMock.mockResolvedValue([fakeSub({ status: "canceled", interval: "year" })]);
      await syncOrgBilling(customerId);
      const ended = await orgRow(orgId);
      expect(ended.stripeStatus).toBe("canceled");
      expect(ended.subscriptionStatus).toBe("cancelled");
      expect(await paid()).toBe(false);
    });
  });

  describe("a customer this Stripe key doesn't know", () => {
    it("throws with an ALERT and leaves the copy alone, so a wrong key never marks paying orgs unpaid", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      await setBillingCopy(orgId, { stripeStatus: "active" });
      const Stripe = (await import("stripe")).default;
      subscriptionsOfMock.mockRejectedValue(
        new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", code: "resource_missing", message: "No such customer" }),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(syncOrgBilling(customerId)).rejects.toThrow("No such customer");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ALERT"));
      expect((await orgRow(orgId)).stripeStatus).toBe("active");
      errorSpy.mockRestore();
    });
  });

  describe("P27: a dead subscription never overwrites a staff-granted complimentary plan", () => {
    it("complimentary org whose only sub is canceled, with stripeStatus already canceled, keeps plan/status and writes no History row", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      await db
        .update(organizations)
        .set({ complimentary: true, complimentaryPlan: "reconciliation_ai" })
        .where(eq(organizations.id, orgId));
      await setBillingCopy(orgId, { stripeStatus: "canceled" });

      const before = await orgRow(orgId);
      subscriptionsOfMock.mockResolvedValue([fakeSub({ status: "canceled" })]);
      expect(await syncOrgBilling(customerId)).toBe("synced");

      const after = await orgRow(orgId);
      expect(after.plan).toBe(before.plan);
      expect(after.subscriptionStatus).toBe(before.subscriptionStatus);
      expect(after.complimentary).toBe(true);
      expect(after.complimentaryPlan).toBe("reconciliation_ai");

      expect(await eventsFor(orgId)).toHaveLength(0);
    });
  });

  describe("I-3: concurrent syncs are serialised by the per-customer lock", () => {
    it("a slow sync started first with older data doesn't overwrite a fast sync started second with newer data", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);

      subscriptionsOfMock
        .mockImplementationOnce(async () => {
          await new Promise((r) => setTimeout(r, 60));
          return [fakeSub({ status: "trialing", plan: "reconciliation" })];
        })
        .mockImplementationOnce(async () => [fakeSub({ status: "active", plan: "reconciliation_ai" })]);

      const [first, second] = await Promise.all([syncOrgBilling(customerId), syncOrgBilling(customerId)]);
      expect(first).toBe("synced");
      expect(second).toBe("synced");

      const row = await orgRow(orgId);
      // The second call's data (newer) must win: the lock forces it to run only after the first
      // call's slow Stripe fetch AND write both finish, so it always writes last.
      expect(row.subscriptionStatus).toBe("active");
      expect(row.plan).toBe("reconciliation_ai");
    });
  });

  describe("I-8: refreshOrgBilling safety net", () => {
    const originalBillingEnabled = process.env.BILLING_ENABLED;
    beforeEach(() => {
      process.env.BILLING_ENABLED = "true";
    });
    afterEach(() => {
      if (originalBillingEnabled === undefined) delete process.env.BILLING_ENABLED;
      else process.env.BILLING_ENABLED = originalBillingEnabled;
    });

    it("not overdue: no sync attempted", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      await setBillingCopy(orgId, { syncedAt: new Date() });

      const result = await refreshOrgBilling(orgId, "stale");
      expect(result).toBe(false);
      expect(subscriptionsOfMock).not.toHaveBeenCalled();
    });

    it("syncedAt null: overdue, syncs", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      subscriptionsOfMock.mockResolvedValue([]);

      const result = await refreshOrgBilling(orgId, "stale");
      expect(result).toBe(true);
      expect(subscriptionsOfMock).toHaveBeenCalledTimes(1);
    });

    it("a second stale refresh within 5 minutes is throttled", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      subscriptionsOfMock.mockResolvedValue([]);

      expect(await refreshOrgBilling(orgId, "stale")).toBe(true);
      subscriptionsOfMock.mockClear();
      // syncedAt now set, but it's the throttle (not overdue-ness) under test here: force
      // overdue again so only the throttle can explain a "false".
      await setBillingCopy(orgId, { syncedAt: null });
      const result = await refreshOrgBilling(orgId, "stale");
      expect(result).toBe(false);
      expect(subscriptionsOfMock).not.toHaveBeenCalled();
    });

    it("Stripe throwing: returns true, row unchanged, doesn't throw", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      const before = await orgRow(orgId);
      subscriptionsOfMock.mockRejectedValue(new Error("stripe is down"));

      await expect(refreshOrgBilling(orgId, "stale")).resolves.toBe(true);
      const after = await orgRow(orgId);
      expect(after.syncedAt).toBeNull();
      expect(after.plan).toBe(before.plan);
      expect(after.subscriptionStatus).toBe(before.subscriptionStatus);
    });

    it("billing off: false, nothing read or attempted", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      process.env.BILLING_ENABLED = "false";

      const result = await refreshOrgBilling(orgId, "stale");
      expect(result).toBe(false);
      expect(subscriptionsOfMock).not.toHaveBeenCalled();
    });
  });

  describe("flagDispute", () => {
    it("a charge belonging to our org: that org's disputed_at set, nobody else's, ALERT logged", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      const bystander = await freshOrg({ complimentary: false });
      await withCustomer(bystander, uniqueCustomerId());
      chargesRetrieveMock.mockResolvedValue({ id: "ch_1", customer: customerId });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await flagDispute({ id: "dp_1", charge: "ch_1" });
      expect(result).toBe("synced");
      expect((await orgRow(orgId)).disputedAt).toBeInstanceOf(Date);
      expect((await orgRow(bystander)).disputedAt).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ALERT"));
    });

    it("a charge belonging to no org here (another business, same Stripe account): untouched, 'unknown_customer'", async () => {
      // An org of ours with its own customer, so a dispute flagged on the wrong row would show.
      const orgId = await freshOrg({ complimentary: false });
      await withCustomer(orgId, uniqueCustomerId());
      chargesRetrieveMock.mockResolvedValue({ id: "ch_2", customer: uniqueCustomerId() });

      const result = await flagDispute({ id: "dp_2", charge: "ch_2" });
      expect(result).toBe("unknown_customer");
      expect((await orgRow(orgId)).disputedAt).toBeNull();
    });

    it("a dispute with no charge: 'unknown_customer' without calling Stripe", async () => {
      const result = await flagDispute({ id: "dp_3", charge: null });
      expect(result).toBe("unknown_customer");
      expect(chargesRetrieveMock).not.toHaveBeenCalled();
    });
  });
});
