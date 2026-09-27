/**
 * P11, D-125: a Stripe copy written in the other mode (a test-mode subscription left in the
 * database after going live, or the reverse) never grants access. Checked through a real
 * consumer of the entitlement, the AI gate, against the real database.
 */
import { config } from "dotenv";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

config({ path: ".env.local", quiet: true });

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("a Stripe copy from the other mode grants nothing (integration)", async () => {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/src/db");
  const { organizations } = await import("@/src/db/schema");
  const { createTestOrg, setBillingCopy } = await import("@/src/db/test-org");
  const { aiAllowedForOrg } = await import("./access");

  const orgIds: string[] = [];

  async function aiOrg(livemode: boolean) {
    const { orgId } = await createTestOrg({ name: `Mode Org ${Date.now()}-${Math.random()}`, complimentary: false });
    orgIds.push(orgId);
    await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, orgId));
    await setBillingCopy(orgId, { livemode, stripeStatus: "active" });
    return orgId;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
  });

  it("an active copy in this mode (test key) is paid; the same copy from live mode is not", async () => {
    vi.stubEnv("BILLING_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_mode_check");
    expect(await aiAllowedForOrg(await aiOrg(false))).toBe(true);
    expect(await aiAllowedForOrg(await aiOrg(true))).toBe(false);
  });

  it("the other way round under a live key", async () => {
    vi.stubEnv("BILLING_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_mode_check");
    expect(await aiAllowedForOrg(await aiOrg(true))).toBe(true);
    expect(await aiAllowedForOrg(await aiOrg(false))).toBe(false);
  });
});
