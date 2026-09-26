/**
 * `src/modules/billing/actions.ts` against real Postgres (Phase 16 §4.1, §8.1, §8.2): the eight
 * `"use server"` adapters, their shared `guard()`/`run()`, and the rules of `billing.ts` they
 * front. Follows `sync.integration.test.ts`'s pattern: `@/src/modules/billing/stripe` is mocked
 * (no real Stripe call is possible), `@/src/lib/action-session` is mocked the way
 * `admin/actions.integration.test.ts` mocks `requireStaff`, and `@/src/modules/billing/sync`'s
 * `syncOrgBilling` always rejects — proving every action's best-effort refresh never fails the
 * action itself (U-8's "a failed refresh after a successful Stripe change doesn't fail the
 * action").
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";
import type Stripe from "stripe";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/action-session", () => ({ actionSessionAnyPlan: vi.fn() }));
vi.mock("@/src/modules/billing/sync", () => ({
  syncOrgBilling: vi.fn().mockRejectedValue(new Error("sync down (test double)")),
}));

const subscriptionsOfMock = vi.fn();
const stripeNowMock = vi.fn().mockResolvedValue(1_650_000_000);

const customersCreateMock = vi.fn();
const customersUpdateMock = vi.fn();
const customersRetrieveMock = vi.fn();
const checkoutSessionsListMock = vi.fn();
const checkoutSessionsCreateMock = vi.fn();
const checkoutSessionsExpireMock = vi.fn();
const pricesListMock = vi.fn();
const invoicesCreatePreviewMock = vi.fn();
const invoicesListMock = vi.fn();
const invoicesVoidMock = vi.fn();
const subscriptionsUpdateMock = vi.fn();
const subscriptionsCancelMock = vi.fn();
const scheduleCreateMock = vi.fn();
const scheduleUpdateMock = vi.fn();
const scheduleRetrieveMock = vi.fn();
const scheduleReleaseMock = vi.fn();
const portalConfigListMock = vi.fn();
const portalSessionsCreateMock = vi.fn();

const stripeClientMock = {
  customers: { create: customersCreateMock, update: customersUpdateMock, retrieve: customersRetrieveMock },
  checkout: {
    sessions: { list: checkoutSessionsListMock, create: checkoutSessionsCreateMock, expire: checkoutSessionsExpireMock },
  },
  prices: { list: pricesListMock },
  invoices: { createPreview: invoicesCreatePreviewMock, list: invoicesListMock, voidInvoice: invoicesVoidMock },
  subscriptions: { update: subscriptionsUpdateMock, cancel: subscriptionsCancelMock },
  subscriptionSchedules: {
    create: scheduleCreateMock,
    update: scheduleUpdateMock,
    retrieve: scheduleRetrieveMock,
    release: scheduleReleaseMock,
  },
  billingPortal: { configurations: { list: portalConfigListMock }, sessions: { create: portalSessionsCreateMock } },
};

vi.mock("@/src/modules/billing/stripe", () => ({
  stripe: () => stripeClientMock,
  subscriptionsOf: (...args: unknown[]) => subscriptionsOfMock(...args),
  idOf: (x: string | { id: string }) => (typeof x === "string" ? x : x.id),
  isMissing: () => false,
  futurePhase: (schedule: Stripe.SubscriptionSchedule) => {
    const current = schedule.current_phase;
    return current ? schedule.phases.find((p) => p.start_date >= current.end_date) : undefined;
  },
  stripeNow: (...args: unknown[]) => stripeNowMock(...args),
}));

config({ path: ".env.local", quiet: true });

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("billing actions (integration, Phase 16)", async () => {
  const { eq, and, isNull } = await import("drizzle-orm");
  const { db } = await import("@/src/db");
  const { organizations, fundingSources } = await import("@/src/db/schema");
  const { createTestOrg, orgWithBilling, setBillingCopy } = await import("@/src/db/test-org");
  const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");
  const { v7: uuidv7 } = await import("uuid");
  const { UI } = await import("@/src/domain/strings");
  const { fail } = await import("@/src/lib/action-result");
  const { actionSessionAnyPlan } = await import("@/src/lib/action-session");
  const { todayIso } = await import("@/src/domain/dates");
  const { stripeKeyIsLive } = await import("@/src/modules/billing/config");
  const {
    startCheckoutAction,
    quoteChangeAction,
    applyChangeAction,
    cancelPendingChangeAction,
    cancelPlanAction,
    endPlanNowAction,
    resumePlanAction,
    billingPortalAction,
  } = await import("./actions");
  const { BILLING_RETURN_PATH, PLAN_CANCELLED_PATH, SETTINGS_PLAN_PATH, clearPortalConfigCache } = await import(
    "./billing"
  );
  const { PORTAL_TAG } = await import("./pricing");
  const { dayAfterStart } = await import("./rules");

  if (stripeKeyIsLive()) throw new Error("refuse to run this suite against a live-looking Stripe key");

  const actionSessionMock = vi.mocked(actionSessionAnyPlan);
  const orgIds: string[] = [];
  let counter = 0;

  async function freshOrg(overrides: { complimentary?: boolean } = {}) {
    counter += 1;
    const { orgId } = await createTestOrg({ name: `Billing Actions Org ${Date.now()}-${counter}`, ...overrides });
    orgIds.push(orgId);
    return orgId;
  }

  function uniqueCustomerId() {
    counter += 1;
    return `cus_actions_test_${Date.now()}_${counter}`;
  }

  async function withCustomer(orgId: string, customerId: string) {
    await setBillingCopy(orgId, { stripeCustomerId: customerId, livemode: false });
  }

  async function activeCount(orgId: string) {
    const { count } = await import("drizzle-orm");
    const [row] = await db
      .select({ total: count() })
      .from(fundingSources)
      .where(and(eq(fundingSources.orgId, orgId), isNull(fundingSources.archivedAt)));
    return row?.total ?? 0;
  }

  async function addFundingSource(orgId: string, opts: { archived?: boolean } = {}) {
    counter += 1;
    await db.insert(fundingSources).values({
      id: uuidv7(),
      orgId,
      name: `Source ${counter}`,
      type: "grant",
      sortOrder: counter,
      archivedAt: opts.archived ? new Date() : null,
      ...ORIGINAL_RULES,
    });
  }

  function asAdmin(orgId: string, userId = `user-${Math.random()}`) {
    actionSessionMock.mockResolvedValue({
      userId,
      orgId,
      email: "admin@example.test",
      role: "admin",
      orgName: "Test Org",
      plan: "reconciliation",
      docName: "Test Org",
      activeMonth: "2026-01",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
    });
  }
  function asManager(orgId: string, userId = `user-${Math.random()}`) {
    actionSessionMock.mockResolvedValue({
      userId,
      orgId,
      email: "manager@example.test",
      role: "manager",
      orgName: "Test Org",
      plan: "reconciliation",
      docName: "Test Org",
      activeMonth: "2026-01",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
    });
  }

  /** All eight actions, called with harmless arguments, returning their `ActionResult`s. */
  async function callAll() {
    return [
      await startCheckoutAction("reconciliation", "month"),
      await quoteChangeAction("reconciliation", "month"),
      await applyChangeAction("reconciliation", "month", 1_650_000_000),
      await cancelPendingChangeAction(),
      await cancelPlanAction(),
      await endPlanNowAction(),
      await resumePlanAction(),
      await billingPortalAction(),
    ];
  }

  function noStripeCallsMade() {
    for (const m of [
      customersCreateMock,
      customersUpdateMock,
      checkoutSessionsCreateMock,
      pricesListMock,
      invoicesCreatePreviewMock,
      subscriptionsUpdateMock,
      subscriptionsCancelMock,
      scheduleCreateMock,
      scheduleUpdateMock,
      scheduleReleaseMock,
      portalSessionsCreateMock,
    ]) {
      expect(m).not.toHaveBeenCalled();
    }
    expect(subscriptionsOfMock).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    actionSessionMock.mockReset();
    subscriptionsOfMock.mockReset().mockResolvedValue([]);
    stripeNowMock.mockReset().mockResolvedValue(1_650_000_000);
    customersCreateMock.mockReset().mockResolvedValue({ id: uniqueCustomerId() });
    customersUpdateMock.mockReset().mockResolvedValue({});
    customersRetrieveMock.mockReset().mockResolvedValue({});
    checkoutSessionsListMock.mockReset().mockResolvedValue({ data: [] });
    checkoutSessionsCreateMock.mockReset().mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" });
    checkoutSessionsExpireMock.mockReset().mockResolvedValue({});
    pricesListMock.mockReset().mockImplementation(({ lookup_keys }: { lookup_keys: string[] }) => {
      const m = /^sf360_(reconciliation_ai|reconciliation)_(month|year)$/.exec(lookup_keys[0]);
      if (!m) return { data: [] };
      const [, plan, interval] = m;
      const cents = plan === "reconciliation" ? { month: 29_700, year: 356_400 } : { month: 49_700, year: 596_400 };
      return {
        data: [
          {
            id: `price_${plan}_${interval}`,
            unit_amount: (cents as Record<string, number>)[interval],
            currency: "usd",
            recurring: { interval },
            metadata: { plan },
          },
        ],
      };
    });
    invoicesCreatePreviewMock.mockReset().mockResolvedValue({ amount_due: 1000, lines: { data: [{ period: { end: 1_700_000_000 } }] } });
    invoicesListMock.mockReset().mockResolvedValue({ data: [] });
    invoicesVoidMock.mockReset().mockResolvedValue({});
    subscriptionsUpdateMock.mockReset().mockResolvedValue({ pending_update: null });
    subscriptionsCancelMock.mockReset().mockResolvedValue({});
    scheduleCreateMock.mockReset();
    scheduleUpdateMock.mockReset().mockResolvedValue({});
    scheduleRetrieveMock.mockReset();
    scheduleReleaseMock.mockReset().mockResolvedValue({});
    portalConfigListMock.mockReset().mockResolvedValue({ data: [{ id: "bpc_1", metadata: { app: PORTAL_TAG } }] });
    portalSessionsCreateMock.mockReset().mockResolvedValue({ url: "https://billing.stripe.com/session/1" });
    clearPortalConfigCache();
    vi.stubEnv("BILLING_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
  });

  /* --------------------------------------------------------------------- I-1 */

  describe("I-1: complimentary org", () => {
    it("switching (quote, apply, cancel a queued change) and End plan now refuse billingComplimentaryRefused before any Stripe call", async () => {
      const orgId = await freshOrg({ complimentary: true });
      asAdmin(orgId);
      expect(await quoteChangeAction("reconciliation", "month")).toEqual(fail(UI.billingComplimentaryRefused));
      expect(await applyChangeAction("reconciliation", "month", 1_650_000_000)).toEqual(fail(UI.billingComplimentaryRefused));
      expect(await cancelPendingChangeAction()).toEqual(fail(UI.billingComplimentaryRefused));
      expect(await endPlanNowAction()).toEqual(fail(UI.billingComplimentaryRefused));
      noStripeCallsMade();
    });

    it("cancel, keep and Card and invoices get past the complimentary check (for a plan bought during it); with no customer they answer billingNoPlan, still with no Stripe call", async () => {
      const orgId = await freshOrg({ complimentary: true });
      asAdmin(orgId);
      expect(await cancelPlanAction()).toEqual(fail(UI.billingNoPlan));
      expect(await resumePlanAction()).toEqual(fail(UI.billingNoPlan));
      expect(await billingPortalAction()).toEqual(fail(UI.billingNoPlan));
      noStripeCallsMade();
    });

    async function compOrg(until: string | null, complimentaryPlan: "reconciliation" | "reconciliation_ai" | null = null) {
      const orgId = await freshOrg({ complimentary: false });
      await db
        .update(organizations)
        .set({ complimentary: true, complimentaryUntil: until, complimentaryPlan, plan: "reconciliation_ai" })
        .where(eq(organizations.id, orgId));
      asAdmin(orgId);
      return orgId;
    }
    const isoIn = (days: number) => todayIso(new Date(Date.now() + days * 86_400_000));
    const sessionArgs = () => checkoutSessionsCreateMock.mock.calls.at(-1)![0];

    it("Checkout with no end date: charged today, the subscription is marked to end the free access once paid", async () => {
      await compOrg(null);
      const result = await startCheckoutAction("reconciliation", "month");
      expect(result.ok).toBe(true);
      const args = sessionArgs();
      expect(args.subscription_data.metadata.endComplimentary).toBe("on_payment");
      expect(args.subscription_data.trial_end).toBeUndefined();
      expect(args.custom_text.submit.message).toBe(UI.billingCheckoutEndsComp);
    });

    it("Checkout with an end date 2+ days away: nothing today, first charge at the start of the next day, no end marker", async () => {
      const until = isoIn(10);
      await compOrg(until);
      const result = await startCheckoutAction("reconciliation", "year");
      expect(result.ok).toBe(true);
      const args = sessionArgs();
      expect(args.subscription_data.trial_end).toBe(Math.floor(dayAfterStart(until).getTime() / 1000));
      expect(args.subscription_data.metadata.endComplimentary).toBeUndefined();
    });

    it("Checkout with an end date tomorrow (too soon for Stripe to defer): charged today with the end marker", async () => {
      await compOrg(isoIn(1));
      await startCheckoutAction("reconciliation", "month");
      const args = sessionArgs();
      expect(args.subscription_data.trial_end).toBeUndefined();
      expect(args.subscription_data.metadata.endComplimentary).toBe("on_payment");
    });

    it("pins the free plan before Checkout, so buying Reconciliation during free Reconciliation + AI keeps the AI features until the free access ends", async () => {
      const orgId = await compOrg(null);
      await startCheckoutAction("reconciliation", "month");
      const [row] = await db
        .select({ complimentaryPlan: organizations.complimentaryPlan })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      expect(row.complimentaryPlan).toBe("reconciliation_ai");
    });

    it("an already pinned free plan is left as it is", async () => {
      const orgId = await compOrg(null, "reconciliation");
      await startCheckoutAction("reconciliation", "month");
      const [row] = await db
        .select({ complimentaryPlan: organizations.complimentaryPlan })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      expect(row.complimentaryPlan).toBe("reconciliation");
    });

    it("a paying org's Checkout is unchanged: no deferral, no end marker, the usual note", async () => {
      const orgId = await freshOrg({ complimentary: false });
      asAdmin(orgId);
      await startCheckoutAction("reconciliation", "month");
      const args = sessionArgs();
      expect(args.subscription_data).toEqual({ metadata: { orgId } });
      expect(args.custom_text.submit.message).toBe(UI.billingCheckoutNote);
      expect(args.adaptive_pricing).toEqual({ enabled: false });
    });

    it("complimentary until today still refuses; until yesterday does not", async () => {
      const orgId = await freshOrg({ complimentary: false });
      await db
        .update(organizations)
        .set({ complimentary: true, complimentaryUntil: todayIso() })
        .where(eq(organizations.id, orgId));
      asAdmin(orgId);
      expect(await cancelPendingChangeAction()).toEqual(fail(UI.billingComplimentaryRefused));
      noStripeCallsMade();

      // Detroit's yesterday, like `todayIso()` above. A UTC date was Detroit's today every evening
      // from 8 pm, and the test failed then.
      await db.update(organizations).set({ complimentaryUntil: isoIn(-1) }).where(eq(organizations.id, orgId));
      // No longer complimentary: falls through to "no_plan" (no Stripe customer), not the
      // complimentary refusal — proving the date boundary, not just the flag, is read.
      expect(await cancelPendingChangeAction()).toEqual(fail(UI.billingNoPlan));
    });
  });

  /* --------------------------------------------------------------------- I-2 */

  describe("I-2: manager", () => {
    it("all eight actions refuse billingNotAdmin, and the Stripe client is never called", async () => {
      const orgId = await freshOrg({ complimentary: false });
      asManager(orgId);
      const results = await callAll();
      for (const r of results) expect(r).toEqual(fail(UI.billingNotAdmin));
      noStripeCallsMade();
    });

    it("role is re-checked on every call: demoted mid-flow refuses the very next call", async () => {
      const orgId = await freshOrg({ complimentary: true }); // complimentary so the admin call fails fast, not on customer lookup
      const userId = `user-${Math.random()}`;
      asAdmin(orgId, userId);
      const first = await cancelPendingChangeAction();
      expect(first).not.toEqual(fail(UI.billingNotAdmin)); // admin got past the role gate

      asManager(orgId, userId);
      const second = await cancelPendingChangeAction();
      expect(second).toEqual(fail(UI.billingNotAdmin));
    });
  });

  /* -------------------------------------------------------------------- U-21 */

  describe("U-21: billing off", () => {
    it("all eight actions refuse billingNotEnabled, and the Stripe client is never called", async () => {
      const orgId = await freshOrg({ complimentary: false });
      asAdmin(orgId);
      vi.stubEnv("BILLING_ENABLED", "false");
      const results = await callAll();
      for (const r of results) expect(r).toEqual(fail(UI.billingNotEnabled));
      noStripeCallsMade();
    });
  });

  /* --------------------------------------------------------------- Rate limit */

  describe("rate limit", () => {
    it("the 21st billing call in a minute for one user is refused billingRateLimited", async () => {
      const orgId = await freshOrg({ complimentary: true });
      const userId = `rate-limit-user-${Date.now()}-${Math.random()}`;
      asAdmin(orgId, userId);

      for (let i = 0; i < 20; i++) {
        const r = await cancelPendingChangeAction();
        expect(r).not.toEqual(fail(UI.billingRateLimited));
      }
      const twentyFirst = await cancelPendingChangeAction();
      expect(twentyFirst).toEqual(fail(UI.billingRateLimited));
    });

    it("rate limiting is per user, not global: a different user is unaffected", async () => {
      const orgId = await freshOrg({ complimentary: true });
      const exhaustedUser = `rate-limit-user-b-${Date.now()}`;
      asAdmin(orgId, exhaustedUser);
      for (let i = 0; i < 21; i++) await cancelPendingChangeAction();

      const otherUser = `rate-limit-user-c-${Date.now()}`;
      asAdmin(orgId, otherUser);
      const r = await cancelPendingChangeAction();
      expect(r).not.toEqual(fail(UI.billingRateLimited));
    });
  });

  /* ---------------------------------------------------------------------U-10 */

  describe("U-10: no action accepts an id from the client", () => {
    it("every exported action's parameter list is only plan/interval/prorationDate (source-reading check)", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const source = fs.readFileSync(path.join(process.cwd(), "src/modules/billing/actions.ts"), "utf8");
      const signatures = [...source.matchAll(/export async function (\w+Action)\(([^)]*)\)/g)];
      expect(signatures.length).toBe(8); // fails loudly if an action is added/renamed without updating this check

      const allowedParamNames = new Set(["plan", "interval", "prorationDate"]);
      for (const [, name, params] of signatures) {
        const names = params
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => p.split(":")[0].trim());
        for (const n of names) {
          expect(allowedParamNames.has(n), `${name} takes an unexpected parameter "${n}"`).toBe(true);
        }
        // Grep the whole signature text for id-shaped names directly, as a second net.
        expect(/\b(customerId|subscriptionId|invoiceId|orgId|scheduleId)\b/i.test(params)).toBe(false);
      }
    });
  });

  /* ---------------------------------------------------------------------U-11 */

  describe("U-11: redirect targets (assertStripeUrl, fixed return paths)", () => {
    async function readyOrgWithNoSub() {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      customersCreateMock.mockResolvedValue({ id: customerId });
      asAdmin(orgId);
      return orgId;
    }

    it.each([
      ["non-https", "http://checkout.stripe.com/pay/cs_1"],
      ["a look-alike host", "https://evil.com/pay/cs_1"],
      ["a stripe.com subdomain of the attacker's domain", "https://stripe.com.evil.com/pay/cs_1"],
      ["a javascript: URL", "javascript:alert(1)"],
    ])("startCheckoutAction rejects a Stripe response with %s", async (_label, url) => {
      await readyOrgWithNoSub();
      checkoutSessionsCreateMock.mockResolvedValue({ id: "cs_1", url });
      await expect(startCheckoutAction("reconciliation", "month")).rejects.toThrow();
    });

    it("accepts checkout.stripe.com and sends the fixed success/cancel paths on siteOrigin()", async () => {
      await readyOrgWithNoSub();
      checkoutSessionsCreateMock.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" });
      const result = await startCheckoutAction("reconciliation", "month");
      expect(result).toEqual({ ok: true, data: { url: "https://checkout.stripe.com/pay/cs_1" } });
      const call = checkoutSessionsCreateMock.mock.calls[0][0];
      expect(call.success_url).toBe(`http://localhost:3000${BILLING_RETURN_PATH}`);
      expect(call.cancel_url).toBe(`http://localhost:3000${PLAN_CANCELLED_PATH}`);
    });

    it("billingPortalAction rejects a non-Stripe portal URL and accepts a real one with the fixed return_url", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      asAdmin(orgId);

      portalSessionsCreateMock.mockResolvedValue({ url: "https://not-stripe.example.com/portal" });
      await expect(billingPortalAction()).rejects.toThrow();

      portalSessionsCreateMock.mockResolvedValue({ url: "https://billing.stripe.com/session/1" });
      const result = await billingPortalAction();
      expect(result).toEqual({ ok: true, data: { url: "https://billing.stripe.com/session/1" } });
      const call = portalSessionsCreateMock.mock.calls[0][0];
      expect(call.return_url).toBe(`http://localhost:3000${SETTINGS_PLAN_PATH}`);
    });
  });

  /* ---------------------------------------------------------------------- P24 */

  describe("P24: funding-source count on a Checkout to Reconciliation", () => {
    it("two active sources: refused before any Stripe call", async () => {
      const orgId = await freshOrg({ complimentary: false });
      await addFundingSource(orgId); // + the one createTestOrg already made = 2 active
      expect(await activeCount(orgId)).toBe(2);
      asAdmin(orgId);

      const result = await startCheckoutAction("reconciliation", "month");
      expect(result).toEqual(fail(UI.billingDowngradeTooManySources(2)));
      expect(pricesListMock).not.toHaveBeenCalled();
      expect(customersCreateMock).not.toHaveBeenCalled();
      expect(checkoutSessionsCreateMock).not.toHaveBeenCalled();
    });

    it("one active + one archived: allowed through to Stripe", async () => {
      const orgId = await freshOrg({ complimentary: false });
      await addFundingSource(orgId, { archived: true }); // + the one active from createTestOrg = 1 active
      expect(await activeCount(orgId)).toBe(1);
      asAdmin(orgId);

      const result = await startCheckoutAction("reconciliation", "month");
      expect(result.ok).toBe(true);
      expect(pricesListMock).toHaveBeenCalled();
      expect(checkoutSessionsCreateMock).toHaveBeenCalled();
    });

    it("Reconciliation + AI is never limited: two active sources still reach Stripe", async () => {
      const orgId = await freshOrg({ complimentary: false });
      await addFundingSource(orgId);
      expect(await activeCount(orgId)).toBe(2);
      asAdmin(orgId);

      const result = await startCheckoutAction("reconciliation_ai", "month");
      expect(result.ok).toBe(true);
      expect(checkoutSessionsCreateMock).toHaveBeenCalled();
    });
  });

  /* --------------------------------------------------------------------- U-8 */

  describe("U-8: error mapping and best-effort refresh", () => {
    async function orgWithCustomer() {
      const orgId = await freshOrg({ complimentary: false });
      const customerId = uniqueCustomerId();
      await withCustomer(orgId, customerId);
      asAdmin(orgId);
      return { orgId, customerId };
    }

    it("unknown_plan: a plan/interval Stripe has no such value for", async () => {
      await orgWithCustomer();
      const result = await startCheckoutAction("not-a-real-plan", "month");
      expect(result).toEqual(fail(UI.billingUnknownPlan));
    });

    it("price_missing: a valid plan/interval whose active price is missing → same billingUnknownPlan text", async () => {
      await orgWithCustomer();
      pricesListMock.mockResolvedValue({ data: [] });
      const result = await startCheckoutAction("reconciliation", "month");
      expect(result).toEqual(fail(UI.billingUnknownPlan));
    });

    it("already_subscribed: a live subscription already exists", async () => {
      await orgWithCustomer();
      subscriptionsOfMock.mockResolvedValue([{ id: "sub_1", status: "active", created: 1 }]);
      const result = await startCheckoutAction("reconciliation", "month");
      expect(result).toEqual(fail(UI.billingAlreadySubscribed));
    });

    it("payment_processing: an incomplete (still paying) subscription exists", async () => {
      await orgWithCustomer();
      subscriptionsOfMock.mockResolvedValue([{ id: "sub_1", status: "incomplete", created: 1 }]);
      const result = await startCheckoutAction("reconciliation", "month");
      expect(result).toEqual(fail(UI.billingPaymentProcessing));
    });

    it("no_plan: quoteChangeAction with no Stripe customer at all", async () => {
      const orgId = await freshOrg({ complimentary: false });
      asAdmin(orgId);
      const result = await quoteChangeAction("reconciliation_ai", "month");
      expect(result).toEqual(fail(UI.billingNoPlan));
    });

    it("payment_failed: quoteChangeAction while the subscription is past_due", async () => {
      const { orgId } = await orgWithCustomer();
      void orgId;
      subscriptionsOfMock.mockResolvedValue([
        { id: "sub_1", status: "past_due", created: 1, cancel_at_period_end: false, cancel_at: null, schedule: null, pending_update: null, items: { data: [{ price: { id: "price_1", metadata: { plan: "reconciliation" }, recurring: { interval: "month" } }, current_period_end: 1 }] } },
      ]);
      const result = await quoteChangeAction("reconciliation_ai", "month");
      expect(result).toEqual(fail(UI.billingPaymentFailedRefused));
    });

    it("cancel_pending: quoteChangeAction while cancel_at_period_end is set", async () => {
      await orgWithCustomer();
      subscriptionsOfMock.mockResolvedValue([
        { id: "sub_1", status: "active", created: 1, cancel_at_period_end: true, cancel_at: null, schedule: null, pending_update: null, items: { data: [{ price: { id: "price_1", metadata: { plan: "reconciliation" }, recurring: { interval: "month" } }, current_period_end: 1 }] } },
      ]);
      const result = await quoteChangeAction("reconciliation_ai", "month");
      expect(result).toEqual(fail(UI.billingCancelPending));
    });

    it("payment_pending: quoteChangeAction while an upgrade already awaits payment", async () => {
      await orgWithCustomer();
      subscriptionsOfMock.mockResolvedValue([
        { id: "sub_1", status: "active", created: 1, cancel_at_period_end: false, cancel_at: null, schedule: null, pending_update: { expires_at: 2 }, items: { data: [{ price: { id: "price_1", metadata: { plan: "reconciliation" }, recurring: { interval: "month" } }, current_period_end: 1 }] } },
      ]);
      const result = await quoteChangeAction("reconciliation_ai", "month");
      expect(result).toEqual(fail(UI.billingPaymentPending));
    });

    it("same_plan: quoting the plan/interval already held", async () => {
      await orgWithCustomer();
      subscriptionsOfMock.mockResolvedValue([
        { id: "sub_1", status: "active", created: 1, cancel_at_period_end: false, cancel_at: null, schedule: null, pending_update: null, items: { data: [{ price: { id: "price_1", metadata: { plan: "reconciliation" }, recurring: { interval: "month" } }, current_period_end: 1 }] } },
      ]);
      const result = await quoteChangeAction("reconciliation", "month");
      expect(result).toEqual(fail(UI.billingSamePlan));
    });

    it("change_pending: an upgrade is refused while a downgrade is queued", async () => {
      await orgWithCustomer();
      const schedule = {
        id: "sub_sched_1",
        current_phase: { start_date: 1, end_date: 2 },
        phases: [
          { start_date: 1, end_date: 2, items: [{ price: { id: "price_1" }, quantity: 1 }] },
          { start_date: 2, end_date: 3, items: [{ price: { id: "price_recon_month" }, quantity: 1 }], metadata: {} },
        ],
      };
      subscriptionsOfMock.mockResolvedValue([
        { id: "sub_1", status: "active", created: 1, cancel_at_period_end: false, cancel_at: null, schedule: "sub_sched_1", pending_update: null, items: { data: [{ price: { id: "price_1", metadata: { plan: "reconciliation" }, recurring: { interval: "month" } }, current_period_end: 1 }] } },
      ]);
      scheduleRetrieveMock.mockResolvedValue(schedule);
      const result = await quoteChangeAction("reconciliation_ai", "month"); // an upgrade
      expect(result).toEqual(fail(UI.billingChangePending));
    });

    it("quote_expired: applyChangeAction with a stale prorationDate", async () => {
      await orgWithCustomer();
      subscriptionsOfMock.mockResolvedValue([
        { id: "sub_1", status: "active", created: 1, cancel_at_period_end: false, cancel_at: null, schedule: null, pending_update: null, items: { data: [{ id: "si_1", price: { id: "price_1", metadata: { plan: "reconciliation" }, recurring: { interval: "month" } }, current_period_end: 1, quantity: 1 }] } },
      ]);
      stripeNowMock.mockResolvedValue(2_000_000);
      const result = await applyChangeAction("reconciliation_ai", "month", 100); // far in the past
      expect(result).toEqual(fail(UI.billingQuoteExpired));
    });

    it("portal_not_setup: no matching billing-portal configuration", async () => {
      await orgWithCustomer();
      portalConfigListMock.mockResolvedValue({ data: [] });
      const result = await billingPortalAction();
      expect(result).toEqual(fail(UI.billingPortalNotSetUp));
    });

    it("a Stripe SDK error is logged and turned into billingStripeError", async () => {
      await orgWithCustomer();
      const Stripe = (await import("stripe")).default;
      const stripeError = Object.create(Stripe.errors.StripeError.prototype);
      Object.assign(stripeError, { type: "StripeAPIError", code: "api_error", requestId: "req_1", message: "boom" });
      subscriptionsOfMock.mockRejectedValue(stripeError);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await quoteChangeAction("reconciliation_ai", "month");
      expect(result).toEqual(fail(UI.billingStripeError));
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("any other error rethrows rather than being swallowed into a UI string", async () => {
      await orgWithCustomer();
      subscriptionsOfMock.mockRejectedValue(new Error("totally unexpected"));
      await expect(quoteChangeAction("reconciliation_ai", "month")).rejects.toThrow("totally unexpected");
    });

    it("a failed refresh after a successful cancel-at-period-end still returns ok (syncOrgBilling always rejects in this suite)", async () => {
      await orgWithCustomer();
      subscriptionsOfMock.mockResolvedValue([
        { id: "sub_1", status: "active", created: 1, cancel_at_period_end: false, cancel_at: null, schedule: null, pending_update: null, items: { data: [{ price: { id: "price_1", metadata: { plan: "reconciliation" }, recurring: { interval: "month" } }, current_period_end: 1 }] } },
      ]);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await cancelPlanAction();
      expect(result).toEqual({ ok: true, data: undefined });
      expect(subscriptionsUpdateMock).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
      errorSpy.mockRestore();
    });
  });

  describe("P11, D-125: a copy from the other Stripe mode", () => {
    it("counts as no copy, and the next Checkout replaces it with a customer in this mode and an empty copy", async () => {
      const orgId = await freshOrg({ complimentary: false });
      asAdmin(orgId);
      // Left over from live mode; this suite runs with a test key.
      await setBillingCopy(orgId, { stripeCustomerId: uniqueCustomerId(), livemode: true, stripeStatus: "active" });
      const newCustomer = uniqueCustomerId();
      customersCreateMock.mockResolvedValue({ id: newCustomer });

      expect(await startCheckoutAction("reconciliation", "month")).toMatchObject({ ok: true });
      expect(customersCreateMock).toHaveBeenCalledTimes(1);
      expect(await orgWithBilling(orgId)).toMatchObject({
        stripeCustomerId: newCustomer,
        livemode: false,
        stripeStatus: null,
      });
    });

    it("a customer already in this mode is reused, never replaced", async () => {
      const orgId = await freshOrg({ complimentary: false });
      asAdmin(orgId);
      const existing = uniqueCustomerId();
      await setBillingCopy(orgId, { stripeCustomerId: existing, livemode: false });

      expect(await startCheckoutAction("reconciliation", "month")).toMatchObject({ ok: true });
      expect(customersCreateMock).not.toHaveBeenCalled();
      expect((await orgWithBilling(orgId)).stripeCustomerId).toBe(existing);
    });
  });
});
