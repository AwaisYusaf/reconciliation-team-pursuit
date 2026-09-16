/**
 * Suspension's effect on sessions, sign-in, reinstatement and the file/download routes
 * (Phase 9 part 2, `docs/PHASE-9.md` §8 "Phase 2"). Complements `actions.integration.test.ts`
 * (which mocks `requireStaff` and stays about the four admin actions' own validation) — this
 * file drives real staff/customer cookie sessions the same way
 * `action-session.staff.integration.test.ts` and `staff-sign-in.integration.test.ts` do, so
 * `resolveSession`'s suspension filter, `signInAction`'s paused branch, and the route handlers
 * are all exercised for real, end to end.
 *
 * Rate-limit buckets are cleared before the sign-in tests for the same reason
 * `staff-sign-in.integration.test.ts` does: `clientIp()` returns the constant "direct" outside
 * production, so every call in this file shares one bucket unless cleared.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

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

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("suspension's effect on sessions and sign-in (integration)", async () => {
  const { db } = await import("@/src/db");
  const {
    expenses,
    fundingSources,
    lineItems,
    organizations,
    paymentSources,
    sessions,
    staffUsers,
    users,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { UI } = await import("@/src/domain/strings");
  const { IDLE } = await import("@/src/lib/action-result");
  const { clearAll } = await import("@/src/services/rate-limit");
  const { createSession, resolveSession } = await import("@/src/services/auth/store");
  const { startSession, startStaffSession, endSession, getSession } = await import(
    "@/src/services/auth/session"
  );
  const { signInAction } = await import("@/src/modules/auth/actions");
  const { suspendOrgAction, reinstateOrgAction } = await import("./actions");
  const { GET: filesGet } = await import("@/app/api/files/[id]/route");
  const { GET: summaryGet } = await import("@/app/api/downloads/summary/route");

  let staffId: string;
  const orgIds: string[] = [];
  // Set by the first suspend-isolation test, read by the tests that follow it — a suspended org
  // and user shared across that ordered sequence, same reasoning as `lock.integration.test.ts`'s
  // `freshMonth()` helper: cheaper than re-suspending for every assertion, and the sequence only
  // reads state the first test already proved.
  let suspendedUserA: { id: string; email: string };

  async function orgWithExpense(name: string) {
    const org = await createTestOrg({ name });
    orgIds.push(org.orgId);

    const [item] = await db
      .insert(lineItems)
      .values({ orgId: org.orgId, fundingSourceId: org.fundingSourceId, name: "Item", scheduledValueCents: 10_000 })
      .returning({ id: lineItems.id });
    await db.insert(paymentSources).values({ orgId: org.orgId, label: "Cash", sortOrder: 0 });
    await db.insert(expenses).values({
      orgId: org.orgId,
      fundingSourceId: org.fundingSourceId,
      lineItemId: item.id,
      month: "2026-01",
      date: "2026-01-05",
      name: "Some expense",
      paymentSource: "Cash",
      taxReimbursable: false,
      feesReimbursable: true,
      referenceSeq: 1,
    });

    return org;
  }

  async function rowCounts(orgId: string) {
    const expenseRows = await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.orgId, orgId));
    const sourceRows = await db
      .select({ id: fundingSources.id })
      .from(fundingSources)
      .where(eq(fundingSources.orgId, orgId));
    return { expenses: expenseRows.length, fundingSources: sourceRows.length };
  }

  async function createUser(orgId: string, password: string) {
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `susp-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword(password),
        role: "admin",
      })
      .returning({ id: users.id, email: users.email });
    return user;
  }

  function formWith(email: string, password: string): FormData {
    const form = new FormData();
    form.set("email", email);
    form.set("password", password);
    return form;
  }

  beforeAll(async () => {
    const [staff] = await db
      .insert(staffUsers)
      .values({
        email: `susp-staff-${Date.now()}@example.test`,
        name: "Suspension Staff",
        passwordHash: await hashPassword("irrelevant-password-1"),
      })
      .returning({ id: staffUsers.id });
    staffId = staff.id;
  });

  afterAll(async () => {
    for (const id of orgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
    if (staffId) await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
  });

  beforeEach(() => {
    clearAll();
  });

  /* ------------------------------------------------------ suspend: isolation ---- */

  it("suspending org A deletes A's sessions, leaves org B's sessions and org row untouched, and A's data unchanged", async () => {
    const orgA = await orgWithExpense("Suspend Isolation A");
    const orgB = await orgWithExpense("Suspend Isolation B");
    const userA = await createUser(orgA.orgId, "user-a-password-1");
    const userB = await createUser(orgB.orgId, "user-b-password-1");

    await createSession(userA.id);
    await createSession(userB.id);
    const countsBefore = await rowCounts(orgA.orgId);

    await startStaffSession(staffId);
    const result = await suspendOrgAction(orgA.orgId, "isolation test");
    expect(result.ok).toBe(true);
    await endSession();

    const sessionsA = await db.select().from(sessions).where(eq(sessions.userId, userA.id));
    expect(sessionsA).toHaveLength(0);

    const sessionsB = await db.select().from(sessions).where(eq(sessions.userId, userB.id));
    expect(sessionsB).toHaveLength(1);

    const [orgBRow] = await db.select().from(organizations).where(eq(organizations.id, orgB.orgId));
    expect(orgBRow.suspendedAt).toBeNull();

    const countsAfter = await rowCounts(orgA.orgId);
    expect(countsAfter).toEqual(countsBefore);

    await db.delete(sessions).where(eq(sessions.userId, userB.id));

    // orgA stays suspended for the next few tests in this file.
    suspendedUserA = userA;
  });

  it("a session token created in the race window (after the suspend commits) resolves to null", async () => {
    const userA = suspendedUserA;

    const raceToken = await createSession(userA.id);
    const resolved = await resolveSession(raceToken);
    expect(resolved).toBeNull();

    await db.delete(sessions).where(eq(sessions.userId, userA.id));
  });

  it("signInAction on the suspended org: correct password -> orgAccessPaused, no session row, last_sign_in_at unchanged; wrong password -> signInWrongPassword", async () => {
    const userA = suspendedUserA;

    const [beforeRow] = await db
      .select({ lastSignInAt: users.lastSignInAt })
      .from(users)
      .where(eq(users.id, userA.id));

    const correct = await signInAction(IDLE, formWith(userA.email, "user-a-password-1"));
    expect(correct).toEqual({ ok: false, error: UI.orgAccessPaused });

    const sessionRows = await db.select().from(sessions).where(eq(sessions.userId, userA.id));
    expect(sessionRows).toHaveLength(0);

    const [afterRow] = await db
      .select({ lastSignInAt: users.lastSignInAt })
      .from(users)
      .where(eq(users.id, userA.id));
    expect(afterRow.lastSignInAt).toBe(beforeRow.lastSignInAt);

    const wrong = await signInAction(IDLE, formWith(userA.email, "totally-wrong-password"));
    expect(wrong).toEqual({ ok: false, error: UI.signInWrongPassword });
  });

  it("app/api/files/[id] and the summary download route reject a suspended org's session", async () => {
    const userA = suspendedUserA;

    await startSession(userA.id); // writes a real `sessions` row and sets the cookie
    expect(await getSession()).toBeNull(); // suspension filter in resolveSession takes effect

    const dummyId = "00000000-0000-7000-8000-000000000000";
    const filesResponse = await filesGet(new Request(`http://localhost/api/files/${dummyId}`), {
      params: Promise.resolve({ id: dummyId }),
    });
    expect(filesResponse.status).toBe(401);

    const summaryResponse = await summaryGet(
      new Request("http://localhost/api/downloads/summary?month=2026-01"),
    );
    expect(summaryResponse.status).toBe(401);

    await db.delete(sessions).where(eq(sessions.userId, userA.id));
    await endSession();
  });

  /* ------------------------------------------------------------------ reinstate */

  it("after reinstateOrgAction, the same credentials sign in again, and the org's expense/funding-source counts are unchanged", async () => {
    const org = await orgWithExpense("Reinstate Flow");
    const user = await createUser(org.orgId, "reinstate-password-1");
    const countsBefore = await rowCounts(org.orgId);

    await startStaffSession(staffId);
    const suspend = await suspendOrgAction(org.orgId, "temporary");
    expect(suspend.ok).toBe(true);
    const reinstate = await reinstateOrgAction(org.orgId, "all clear");
    expect(reinstate.ok).toBe(true);
    await endSession();

    await expect(
      signInAction(IDLE, formWith(user.email, "reinstate-password-1")),
    ).rejects.toThrow("NEXT_REDIRECT:/onboarding/line-items");

    const sessionRows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(sessionRows).toHaveLength(1);
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    await endSession();

    const countsAfter = await rowCounts(org.orgId);
    expect(countsAfter).toEqual(countsBefore);
  });
});
