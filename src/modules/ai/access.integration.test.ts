/**
 * `summariesAccessForOrg`/`readAmountsAllowedForOrg`/`aiAllowedForOrg` against real Postgres
 * (Phase 15, I-4, I-5, §4.2). These three loaders read the billing columns fresh and gate on
 * `orgEntitlement`, unlike `access.test.ts`'s pure combinators — that file still covers
 * `canReadAmounts`/`canUseSummaries`/`canWriteSummaries` alone.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

config({ path: ".env.local", quiet: true });

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("AI access loaders (integration, Phase 15)", async () => {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/src/db");
  const { organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { summariesAccessForOrg, readAmountsAllowedForOrg, aiAllowedForOrg } = await import("./access");

  const orgIds: string[] = [];
  let counter = 0;

  async function freshOrg(overrides: { complimentary?: boolean } = {}) {
    counter += 1;
    const { orgId } = await createTestOrg({ name: `AI Access Org ${Date.now()}-${counter}`, ...overrides });
    orgIds.push(orgId);
    return orgId;
  }

  async function setOrg(
    orgId: string,
    patch: Partial<{
      plan: "reconciliation" | "reconciliation_ai";
      complimentary: boolean;
      complimentaryUntil: string | null;
      complimentaryPlan: "reconciliation" | "reconciliation_ai" | null;
      stripeStatus: string | null;
      readAmountsEnabled: boolean;
    }>,
  ) {
    await db.update(organizations).set(patch).where(eq(organizations.id, orgId));
  }

  beforeEach(() => {
    vi.stubEnv("BILLING_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "sk-real");
    vi.stubEnv("OPENAI_READ_MODEL", "gpt-5.6-luna");
    vi.stubEnv("OPENAI_SUMMARY_MODEL", "gpt-5.6-terra");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
  });

  describe("I-4: a cancelled Reconciliation + AI org loses AI", () => {
    it.each(["canceled", null])("stripeStatus=%s, not complimentary → no AI anywhere", async (status) => {
      const orgId = await freshOrg({ complimentary: false });
      await setOrg(orgId, { plan: "reconciliation_ai", stripeStatus: status });

      expect(await summariesAccessForOrg(orgId)).toEqual({ use: false, write: false });
      expect(await readAmountsAllowedForOrg(orgId)).toBe(false);
      expect(await aiAllowedForOrg(orgId)).toBe(false);
    });
  });

  describe("I-5: past_due keeps AI, active has AI", () => {
    it.each(["past_due", "active", "trialing"])("stripeStatus=%s → AI kept", async (status) => {
      const orgId = await freshOrg({ complimentary: false });
      await setOrg(orgId, { plan: "reconciliation_ai", stripeStatus: status });

      expect(await summariesAccessForOrg(orgId)).toEqual({ use: true, write: true });
      expect(await readAmountsAllowedForOrg(orgId)).toBe(true);
      expect(await aiAllowedForOrg(orgId)).toBe(true);
    });
  });

  describe("billing off: today's behaviour regardless of Stripe state", () => {
    it("no subscription at all, billing off → still paid on the org's plan", async () => {
      vi.stubEnv("BILLING_ENABLED", "false");
      const orgId = await freshOrg({ complimentary: false });
      await setOrg(orgId, { plan: "reconciliation_ai", stripeStatus: null });

      expect(await aiAllowedForOrg(orgId)).toBe(true);
      expect(await readAmountsAllowedForOrg(orgId)).toBe(true);
    });

    it("base plan, billing off → still no AI (billing_off doesn't grant a different plan)", async () => {
      vi.stubEnv("BILLING_ENABLED", "false");
      const orgId = await freshOrg({ complimentary: false });
      await setOrg(orgId, { plan: "reconciliation", stripeStatus: null });

      expect(await aiAllowedForOrg(orgId)).toBe(false);
    });
  });

  describe("complimentary: AI by plan", () => {
    it("base plan org with a complimentary Reconciliation + AI grant gets AI", async () => {
      const orgId = await freshOrg({ complimentary: true });
      await setOrg(orgId, { plan: "reconciliation", complimentaryPlan: "reconciliation_ai", stripeStatus: null });

      expect(await aiAllowedForOrg(orgId)).toBe(true);
      expect(await readAmountsAllowedForOrg(orgId)).toBe(true);
    });

    it("complimentary with no complimentary_plan override falls back to plan", async () => {
      const orgId = await freshOrg({ complimentary: true });
      await setOrg(orgId, { plan: "reconciliation_ai", complimentaryPlan: null, stripeStatus: null });

      expect(await aiAllowedForOrg(orgId)).toBe(true);
    });

    it("a dead old subscription never overwrites a complimentary grant's AI access", async () => {
      const orgId = await freshOrg({ complimentary: true });
      // A subscription that lapsed to "canceled" while the org is complimentary on the AI plan.
      await setOrg(orgId, { plan: "reconciliation", complimentaryPlan: "reconciliation_ai", stripeStatus: "canceled" });

      expect(await aiAllowedForOrg(orgId)).toBe(true);
    });
  });

  describe("edge: unknown org", () => {
    it("a non-existent org id returns everything false rather than throwing", async () => {
      const absentId = "00000000-0000-7000-8000-000000000000";
      expect(await summariesAccessForOrg(absentId)).toEqual({ use: false, write: false });
      expect(await readAmountsAllowedForOrg(absentId)).toBe(false);
      expect(await aiAllowedForOrg(absentId)).toBe(false);
    });
  });
});

/**
 * Route-level 403 (spec: "the AI routes that use them ... 403 for a cancelled Plus org if there
 * is an existing route-test pattern to follow"): no route handler test file exists anywhere in
 * this codebase today (checked: no `app/**\/*.test.ts`), so there is no established pattern for
 * invoking a Next.js route handler directly in this suite (request/response construction,
 * `sameOrigin` header setup, etc. would all be new scaffolding). Skipped rather than inventing
 * one ad hoc; `readAmountsAllowedForOrg`'s own false result above is what
 * `app/api/files/read-amounts/route.ts` returns 403 on, so the route's behaviour is covered up
 * to its one call site.
 */
