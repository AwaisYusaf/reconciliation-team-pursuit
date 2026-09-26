/**
 * `changePlanAction` (P16, AC-I1) and the suspend/reinstate → `setCollectionPaused` wiring (D3,
 * AC-I3), against real Postgres. Kept out of `actions.integration.test.ts` (not edited per the
 * task brief) so its own `@/src/lib/action-session` `requireStaff` mock and — new here — a
 * mocked `@/src/modules/billing/billing`'s `setCollectionPaused` don't have to be reconciled
 * with that file's existing mocks.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("@/src/lib/action-session", () => ({
  requireStaff: vi.fn(),
  FORBIDDEN: "You do not have permission to do that.",
}));

const setCollectionPausedMock = vi.fn().mockResolvedValue(undefined);
const staffCancelMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/src/modules/billing/billing", () => ({
  setCollectionPaused: (...args: unknown[]) => setCollectionPausedMock(...args),
  staffCancelSubscription: (...args: unknown[]) => staffCancelMock(...args),
}));

const alertMock = vi.fn();
vi.mock("@/src/modules/billing/sync", () => ({
  alert: (...args: unknown[]) => alertMock(...args),
}));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("P16 (staff-managed while live) and D3 (collection pause wiring)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, orgAccountEvents, staffUsers } = await import("@/src/db/schema");
  const { createTestOrg, setBillingCopy } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { UI } = await import("@/src/domain/strings");
  const { fail } = await import("@/src/lib/action-result");
  const { requireStaff } = await import("@/src/lib/action-session");
  const { changePlanAction, setComplimentaryAction, suspendOrgAction, reinstateOrgAction } = await import("./actions");
  const { entitlementOf } = await import("@/src/services/auth/entitlement");

  const requireStaffMock = vi.mocked(requireStaff);

  let staffId: string;
  const orgIds: string[] = [];

  function asStaff() {
    requireStaffMock.mockResolvedValue({ staffId, email: "staff@example.test", name: "Staff" });
  }

  async function freshOrg(overrides: { complimentary?: boolean } = {}) {
    const org = await createTestOrg({ name: `P16 D3 Org ${Date.now()}-${Math.random()}`, ...overrides });
    orgIds.push(org.orgId);
    return org.orgId;
  }

  async function setStripeStatus(orgId: string, status: string | null) {
    await setBillingCopy(orgId, { stripeStatus: status });
  }

  async function eventsFor(orgId: string) {
    return db.select().from(orgAccountEvents).where(eq(orgAccountEvents.orgId, orgId));
  }

  beforeAll(async () => {
    const [staff] = await db
      .insert(staffUsers)
      .values({
        email: `p16-d3-staff-${Date.now()}@example.test`,
        name: "P16 D3 Staff",
        passwordHash: await hashPassword("irrelevant-password-1"),
      })
      .returning({ id: staffUsers.id });
    staffId = staff.id;
  });

  afterAll(async () => {
    for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
    if (staffId) await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
  });

  beforeEach(() => {
    vi.stubEnv("BILLING_ENABLED", "true");
    setCollectionPausedMock.mockReset().mockResolvedValue(undefined);
    staffCancelMock.mockReset().mockResolvedValue(undefined);
    alertMock.mockReset();
    asStaff();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("P16: changePlanAction refuses while a subscription is live", () => {
    it.each(["active", "past_due", "trialing", "unpaid", "paused"])(
      "stripeStatus=%s, billing on → staffStripeManaged, nothing written",
      async (status) => {
        const orgId = await freshOrg({ complimentary: false });
        await setStripeStatus(orgId, status);
        const result = await changePlanAction(orgId, "reconciliation_ai", "active", "");
        expect(result).toEqual(fail(UI.staffStripeManaged));
        expect(await eventsFor(orgId)).toHaveLength(0);
      },
    );

    it.each(["canceled", null])("stripeStatus=%s, billing on → allowed", async (status) => {
      const orgId = await freshOrg({ complimentary: false });
      await setStripeStatus(orgId, status);
      const result = await changePlanAction(orgId, "reconciliation_ai", "active", "");
      expect(result.ok).toBe(true);
      expect(await eventsFor(orgId)).toHaveLength(1);
    });

    it.each([
      ["a different plan", "reconciliation_ai", "reconciliation"],
      ["the same plan label, with a different free plan pinned", "reconciliation", "reconciliation"],
    ] as const)(
      "a complimentary org's pinned free plan gives way to the plan staff choose (%s)",
      async (_case, planBefore, chosen) => {
        const orgId = await freshOrg({ complimentary: true });
        // Pinned by a Checkout the admin never finished (P27).
        await db
          .update(organizations)
          .set({ plan: planBefore, subscriptionStatus: "active", complimentaryPlan: "reconciliation_ai" })
          .where(eq(organizations.id, orgId));

        const result = await changePlanAction(orgId, chosen, "active", "");
        expect(result.ok).toBe(true);
        const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId));
        expect(row.complimentaryPlan).toBeNull();
        expect(entitlementOf(row).plan).toBe(chosen);
      },
    );

    it("billing off → allowed even with an active stripeStatus", async () => {
      vi.stubEnv("BILLING_ENABLED", "false");
      const orgId = await freshOrg({ complimentary: false });
      await setStripeStatus(orgId, "active");
      const result = await changePlanAction(orgId, "reconciliation_ai", "active", "");
      expect(result.ok).toBe(true);
    });

    it("complimentary access still works on an org with a live subscription", async () => {
      const orgId = await freshOrg({ complimentary: false });
      await setStripeStatus(orgId, "active");
      const result = await setComplimentaryAction(orgId, true, "", "", "period_end");
      expect(result.ok).toBe(true);
    });

    it("suspend still works on an org with a live subscription", async () => {
      const orgId = await freshOrg({ complimentary: false });
      await setStripeStatus(orgId, "active");
      const result = await suspendOrgAction(orgId, "for the test");
      expect(result.ok).toBe(true);
    });
  });

  describe("I-7: complimentary for a paying org ends the paid plan in the same step", () => {
    async function complimentary(orgId: string) {
      const [row] = await db
        .select({ complimentary: organizations.complimentary })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      return row.complimentary;
    }

    it.each([null, "later" as never])("no valid choice (%s) → refused, nothing written, Stripe untouched", async (choice) => {
      const orgId = await freshOrg({ complimentary: false });
      await setStripeStatus(orgId, "active");
      const result = await setComplimentaryAction(orgId, true, "", "", choice);
      expect(result).toEqual(fail(UI.staffCompCancelRequired));
      expect(staffCancelMock).not.toHaveBeenCalled();
      expect(await complimentary(orgId)).toBe(false);
      expect(await eventsFor(orgId)).toHaveLength(0);
    });

    it.each(["now", "period_end"] as const)("choice %s → Stripe cancelled that way, then access granted", async (choice) => {
      const orgId = await freshOrg({ complimentary: false });
      await setStripeStatus(orgId, "past_due");
      const result = await setComplimentaryAction(orgId, true, "", "", choice);
      expect(result.ok).toBe(true);
      expect(staffCancelMock).toHaveBeenCalledExactlyOnceWith(orgId, choice);
      expect(await complimentary(orgId)).toBe(true);
    });

    it("Stripe failing → refused with the payment-service message, access not granted", async () => {
      const orgId = await freshOrg({ complimentary: false });
      await setStripeStatus(orgId, "active");
      staffCancelMock.mockRejectedValueOnce(new Error("Stripe is down"));
      const result = await setComplimentaryAction(orgId, true, "", "", "now");
      expect(result).toEqual(fail(UI.billingStripeError));
      expect(await complimentary(orgId)).toBe(false);
      expect(await eventsFor(orgId)).toHaveLength(0);
    });

    it.each([
      ["no live subscription", "canceled", true, false],
      ["billing off", "active", false, false],
      ["already complimentary (changing the end date)", "active", true, true],
    ])("%s → no choice needed, Stripe untouched", async (_name, status, billingOn, alreadyComp) => {
      if (!billingOn) vi.stubEnv("BILLING_ENABLED", "false");
      const orgId = await freshOrg({ complimentary: alreadyComp });
      await setStripeStatus(orgId, status);
      const result = await setComplimentaryAction(orgId, true, "2027-01-31", "");
      expect(result.ok).toBe(true);
      expect(staffCancelMock).not.toHaveBeenCalled();
    });

    it("removing complimentary never touches Stripe", async () => {
      const orgId = await freshOrg({ complimentary: true });
      await setStripeStatus(orgId, "active");
      const result = await setComplimentaryAction(orgId, false, "", "");
      expect(result.ok).toBe(true);
      expect(staffCancelMock).not.toHaveBeenCalled();
    });
  });

  describe("D3: suspend/reinstate call setCollectionPaused only on success", () => {
    it("a successful suspend pauses collection with (orgId, true)", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const result = await suspendOrgAction(orgId, "for the test");
      expect(result.ok).toBe(true);
      expect(setCollectionPausedMock).toHaveBeenCalledTimes(1);
      expect(setCollectionPausedMock).toHaveBeenCalledWith(orgId, true);
    });

    it("a successful reinstate resumes collection with (orgId, false)", async () => {
      const orgId = await freshOrg({ complimentary: false });
      await suspendOrgAction(orgId, "for the test");
      setCollectionPausedMock.mockClear();
      const result = await reinstateOrgAction(orgId, "");
      expect(result.ok).toBe(true);
      expect(setCollectionPausedMock).toHaveBeenCalledTimes(1);
      expect(setCollectionPausedMock).toHaveBeenCalledWith(orgId, false);
    });

    it("setCollectionPaused throwing on suspend: the suspension still succeeds, and alert() is called", async () => {
      const orgId = await freshOrg({ complimentary: false });
      setCollectionPausedMock.mockRejectedValueOnce(new Error("Stripe is down"));
      const result = await suspendOrgAction(orgId, "for the test");
      expect(result.ok).toBe(true); // the DB write already committed; a Stripe failure doesn't undo it
      expect(alertMock).toHaveBeenCalledTimes(1);

      const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
      expect(row.suspendedAt).not.toBeNull();
    });

    it("setCollectionPaused throwing on reinstate: the reinstatement still succeeds, and alert() is called", async () => {
      const orgId = await freshOrg({ complimentary: false });
      await suspendOrgAction(orgId, "for the test");
      setCollectionPausedMock.mockRejectedValueOnce(new Error("Stripe is down"));
      const result = await reinstateOrgAction(orgId, "");
      expect(result.ok).toBe(true);
      expect(alertMock).toHaveBeenCalledTimes(1);
    });

    it("a failed suspend (already suspended) never calls setCollectionPaused", async () => {
      const orgId = await freshOrg({ complimentary: false });
      await suspendOrgAction(orgId, "first");
      setCollectionPausedMock.mockClear();

      const second = await suspendOrgAction(orgId, "second");
      expect(second).toEqual(fail(UI.orgAlreadySuspended));
      expect(setCollectionPausedMock).not.toHaveBeenCalled();
    });

    it("a failed reinstate (not suspended) never calls setCollectionPaused", async () => {
      const orgId = await freshOrg({ complimentary: false });
      const result = await reinstateOrgAction(orgId, "");
      expect(result).toEqual(fail(UI.orgNotSuspended));
      expect(setCollectionPausedMock).not.toHaveBeenCalled();
    });
  });
});
