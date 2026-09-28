/**
 * PHASE-18 (D-131): the header's month and funding source, and the welcome banner's dismissal, are
 * each person's own. Two managers of
 * one organization sign in for real (cookie → `getSession` → `resolveSession`), so what one picks
 * is proven not to reach the other through the path every page, action and route reads.
 * Skipped when DATABASE_URL is absent.
 */
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => {
  let cookieValue: string | undefined;
  return {
    cookies: async () => ({
      get: (name: string) => (name === "session" && cookieValue !== undefined ? { name, value: cookieValue } : undefined),
      set: (name: string, value: string) => {
        if (name === "session") cookieValue = value;
      },
      delete: (name: string) => {
        if (name === "session") cookieValue = undefined;
      },
    }),
    headers: async () => ({ get: () => null }),
  };
});

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("per-person month and funding source (integration, PHASE-18)", async () => {
  const { db } = await import("@/src/db");
  const { fundingSources, organizations, users } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");
  const { getSession, startSession, endSession } = await import("@/src/services/auth/session");
  const { dismissWelcomeAction, setActiveFundingSourceAction, setActiveMonthAction } = await import("./actions");

  const orgIds: string[] = [];
  let managerA: string;
  let managerB: string;
  let firstSource: string;
  let secondSource: string;

  async function person(orgId: string, tag: string, activeMonth: string) {
    const [row] = await db
      .insert(users)
      .values({ orgId, email: `p18-${tag}-${Date.now()}@example.test`, passwordHash: "unused", role: "manager", activeMonth })
      .returning({ id: users.id });
    return row.id;
  }

  /** Signs `userId` in (replacing whoever was) and returns what every page would read. */
  async function sessionOf(userId: string) {
    await startSession(userId);
    const session = await getSession();
    if (!session) throw new Error("no session");
    return session;
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: `Phase 18 ${Date.now()}`, activeMonth: "2026-01" });
    orgIds.push(org.orgId);
    firstSource = org.fundingSourceId;
    const [second] = await db
      .insert(fundingSources)
      .values({ orgId: org.orgId, name: "Second", type: "grant", sortOrder: 1, ...ORIGINAL_RULES })
      .returning({ id: fundingSources.id });
    secondSource = second.id;
    managerA = await person(org.orgId, "a", "2026-02");
    managerB = await person(org.orgId, "b", "2026-02");
  });

  afterAll(async () => {
    await endSession();
    for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
  });

  it("T1: manager A switching month moves A only; B stays where B was, and the org is untouched", async () => {
    await sessionOf(managerA);
    expect(await setActiveMonthAction("2026-03")).toEqual({ ok: true });

    expect((await sessionOf(managerA)).activeMonth).toBe("2026-03");
    expect((await sessionOf(managerB)).activeMonth).toBe("2026-02");
    const [org] = await db.select({ m: organizations.activeMonth }).from(organizations).where(eq(organizations.id, orgIds[0]));
    expect(org.m).toBe("2026-01");
  });

  it("T1: manager B switching back does not move A", async () => {
    await sessionOf(managerB);
    expect(await setActiveMonthAction("2026-04")).toEqual({ ok: true });
    expect((await sessionOf(managerA)).activeMonth).toBe("2026-03");
    expect((await sessionOf(managerB)).activeMonth).toBe("2026-04");
  });

  it("T1: the funding source is per person the same way, and All (null) is a choice too", async () => {
    await sessionOf(managerA);
    expect(await setActiveFundingSourceAction(secondSource)).toEqual({ ok: true });
    await sessionOf(managerB);
    expect(await setActiveFundingSourceAction(firstSource)).toEqual({ ok: true });

    expect((await sessionOf(managerA)).activeFundingSourceId).toBe(secondSource);
    expect((await sessionOf(managerB)).activeFundingSourceId).toBe(firstSource);

    expect(await setActiveFundingSourceAction(null)).toEqual({ ok: true });
    expect((await sessionOf(managerA)).activeFundingSourceId).toBe(secondSource);
    expect((await sessionOf(managerB)).activeFundingSourceId).toBeNull();
    const [org] = await db
      .select({ s: organizations.activeFundingSourceId })
      .from(organizations)
      .where(eq(organizations.id, orgIds[0]));
    expect(org.s).toBeNull();
  });

  it("T5: another organization's source is refused and nothing is stored", async () => {
    const other = await createTestOrg({ name: `Phase 18 other ${Date.now()}` });
    orgIds.push(other.orgId);
    await sessionOf(managerA);
    const before = (await sessionOf(managerA)).activeFundingSourceId;

    const result = await setActiveFundingSourceAction(other.fundingSourceId);
    expect(result.ok).toBe(false);
    expect((await sessionOf(managerA)).activeFundingSourceId).toBe(before);
  });

  it("dismissing the welcome banner hides it for that person only", async () => {
    expect((await sessionOf(managerA)).welcomeDismissed).toBe(false);
    expect(await dismissWelcomeAction()).toEqual({ ok: true });

    expect((await sessionOf(managerA)).welcomeDismissed).toBe(true);
    expect((await sessionOf(managerB)).welcomeDismissed).toBe(false);
    const [org] = await db
      .select({ d: organizations.welcomeDismissedAt })
      .from(organizations)
      .where(eq(organizations.id, orgIds[0]));
    expect(org.d).toBeNull();
  });

  it("a malformed month is refused and nothing is stored", async () => {
    await sessionOf(managerA);
    expect((await setActiveMonthAction("2026-13")).ok).toBe(false);
    expect((await sessionOf(managerA)).activeMonth).toBe("2026-03");
  });
});
