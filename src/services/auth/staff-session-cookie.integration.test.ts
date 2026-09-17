/**
 * Cookie-layer coverage for staff sessions (Phase 9, D-98) — `getStaffSession`,
 * `startSession`/`startStaffSession`/`endSession` clearing both tables on a shared device.
 *
 * `next/headers` is replaced with an in-memory cookie jar (closure state on the mock module,
 * manipulated through `__setSessionCookie`/`__getSessionCookie`) so the REAL `session.ts` and
 * `store.ts` run against the database — only the cookie transport is faked, matching the
 * project's convention of mocking as little as possible.
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
    __setSessionCookie: (value: string | undefined) => {
      cookieValue = value;
    },
    __getSessionCookie: () => cookieValue,
  };
});

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("staff session cookie layer (integration)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, sessions, staffSessions, staffUsers, users } = await import("@/src/db/schema");
  const { hashPassword } = await import("./passwords");
  const nextHeaders = (await import("next/headers")) as unknown as {
    __setSessionCookie: (v: string | undefined) => void;
    __getSessionCookie: () => string | undefined;
  };
  const {
    getSession,
    getStaffSession,
    startSession,
    startStaffSession,
    endSession,
  } = await import("./session");

  let orgId: string;
  let userId: string;
  let staffId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Cookie Org", docName: "Cookie", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    orgId = org.id;

    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `cookie-customer-${Date.now()}@example.test`,
        passwordHash: "unused",
        role: "admin",
      })
      .returning({ id: users.id });
    userId = user.id;

    const [staff] = await db
      .insert(staffUsers)
      .values({
        email: `cookie-staff-${Date.now()}@example.test`,
        name: "Cookie Staff",
        passwordHash: await hashPassword("irrelevant-password-1"),
      })
      .returning({ id: staffUsers.id });
    staffId = staff.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
    if (staffId) await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
  });

  beforeEach(() => {
    nextHeaders.__setSessionCookie(undefined);
  });

  it("getStaffSession resolves a staff cookie and returns null with no cookie", async () => {
    expect(await getStaffSession()).toBeNull();

    await startStaffSession(staffId);
    const resolved = await getStaffSession();
    expect(resolved).not.toBeNull();
    expect(resolved!.staffId).toBe(staffId);

    await endSession();
  });

  it("startSession on a device already holding a staff cookie deletes the staff_sessions row", async () => {
    await startStaffSession(staffId);
    const staffTokenHash = await hashOfCurrentCookie();

    await startSession(userId);

    // The staff row this device held is gone.
    const staffRows = await db.select().from(staffSessions).where(eq(staffSessions.id, staffTokenHash));
    expect(staffRows).toHaveLength(0);
    expect(await getStaffSession()).toBeNull();
    expect(await getSession()).not.toBeNull();

    await endSession();
  });

  it("startStaffSession on a device already holding a customer cookie deletes the sessions row", async () => {
    await startSession(userId);
    const customerTokenHash = await hashOfCurrentCookie();

    await startStaffSession(staffId);

    const customerRows = await db.select().from(sessions).where(eq(sessions.id, customerTokenHash));
    expect(customerRows).toHaveLength(0);
    expect(await getSession()).toBeNull();
    expect(await getStaffSession()).not.toBeNull();

    await endSession();
  });

  it("endSession with a staff cookie deletes the row and clears the cookie", async () => {
    await startStaffSession(staffId);
    const staffTokenHash = await hashOfCurrentCookie();

    await endSession();

    expect(nextHeaders.__getSessionCookie()).toBeUndefined();
    const rows = await db.select().from(staffSessions).where(eq(staffSessions.id, staffTokenHash));
    expect(rows).toHaveLength(0);
    expect(await getStaffSession()).toBeNull();
  });

  async function hashOfCurrentCookie(): Promise<string> {
    const { hashSessionToken } = await import("./tokens");
    const token = nextHeaders.__getSessionCookie();
    if (!token) throw new Error("expected a session cookie to be set");
    return hashSessionToken(token);
  }
});
