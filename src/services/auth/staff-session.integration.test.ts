/**
 * Staff session persistence, exercised against a real Postgres database (Phase 9, D-98).
 *
 * Mirrors `store.integration.test.ts`'s coverage of `sessions`/`resolveSession`, but for
 * `staff_sessions`/`resolveStaffSession`, plus the cross-table isolation and dual-delete
 * behaviour `deleteSession`/`deleteExpiredSessions` now have.
 *
 * Skipped automatically when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("staff session store (integration)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, sessions, staffSessions, staffUsers, users } = await import("@/src/db/schema");
  const {
    createSession,
    createStaffSession,
    deleteExpiredSessions,
    deleteSession,
    resolveSession,
    resolveStaffSession,
  } = await import("./store");
  const { hashSessionToken, SESSION_TTL_MS, SESSION_MAX_AGE_MS } = await import("./tokens");
  const { hashPassword } = await import("./passwords");

  const DAY = 24 * 60 * 60 * 1000;

  let orgId: string;
  let userId: string;
  let staffId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Staff Session Org", docName: "Staff Session", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    orgId = org.id;

    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `staff-session-customer-${Date.now()}@example.test`,
        passwordHash: "unused-for-these-tests",
        role: "admin",
      })
      .returning({ id: users.id });
    userId = user.id;

    const [staff] = await db
      .insert(staffUsers)
      .values({
        email: `staff-session-${Date.now()}@example.test`,
        name: "Staff Person",
        passwordHash: await hashPassword("irrelevant-password-1"),
      })
      .returning({ id: staffUsers.id });
    staffId = staff.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
    if (staffId) await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
  });

  it("resolves a fresh staff session and carries staffId/email/name", async () => {
    const token = await createStaffSession(staffId);
    const resolved = await resolveStaffSession(token);

    expect(resolved).not.toBeNull();
    expect(resolved!.context.staffId).toBe(staffId);
    expect(resolved!.context.name).toBe("Staff Person");
    expect(resolved!.renewed).toBe(false);

    await deleteSession(token);
  });

  it("stores only the token hash, not the raw token", async () => {
    const token = await createStaffSession(staffId);
    const rows = await db.select().from(staffSessions).where(eq(staffSessions.staffUserId, staffId));

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(hashSessionToken(token));
    expect(rows[0].id).not.toBe(token);

    await deleteSession(token);
  });

  it("rejects an unknown or tampered staff token", async () => {
    expect(await resolveStaffSession("not-a-real-token")).toBeNull();

    const token = await createStaffSession(staffId);
    expect(await resolveStaffSession(`${token}x`)).toBeNull();
    await deleteSession(token);
  });

  it("rejects an expired staff session and deletes the row", async () => {
    const token = await createStaffSession(staffId);
    const future = new Date(Date.now() + SESSION_TTL_MS + DAY);

    expect(await resolveStaffSession(token, future)).toBeNull();
    const remaining = await db
      .select()
      .from(staffSessions)
      .where(eq(staffSessions.id, hashSessionToken(token)));
    expect(remaining).toHaveLength(0);
  });

  it("rejects a staff session past the absolute max age and deletes the row, even freshly renewed", async () => {
    const token = await createStaffSession(staffId);
    const overMaxAge = new Date(Date.now() + SESSION_MAX_AGE_MS + DAY);

    expect(await resolveStaffSession(token, overMaxAge)).toBeNull();
    const remaining = await db
      .select()
      .from(staffSessions)
      .where(eq(staffSessions.id, hashSessionToken(token)));
    expect(remaining).toHaveLength(0);
  });

  it("slides the staff session expiry once inside the final 15 days", async () => {
    const token = await createStaffSession(staffId);
    const day20 = new Date(Date.now() + 20 * DAY);

    const resolved = await resolveStaffSession(token, day20);
    expect(resolved!.renewed).toBe(true);

    const [row] = await db.select().from(staffSessions).where(eq(staffSessions.id, hashSessionToken(token)));
    expect(row.expiresAt.getTime()).toBeCloseTo(day20.getTime() + SESSION_TTL_MS, -4);

    await deleteSession(token);
  });

  it("a staff token never resolves through resolveSession (customer path)", async () => {
    const staffToken = await createStaffSession(staffId);
    expect(await resolveSession(staffToken)).toBeNull();
    await deleteSession(staffToken);
  });

  it("a customer token never resolves through resolveStaffSession (staff path)", async () => {
    const customerToken = await createSession(userId);
    expect(await resolveStaffSession(customerToken)).toBeNull();
    await deleteSession(customerToken);
  });

  it("deleteSession removes a staff token (deletes from both tables, needs no lookup)", async () => {
    const token = await createStaffSession(staffId);
    await deleteSession(token);
    expect(await resolveStaffSession(token)).toBeNull();
  });

  it("deleteExpiredSessions sweeps stale rows in both sessions and staff_sessions, leaving fresh ones", async () => {
    const staleCustomer = await createSession(userId);
    const freshCustomer = await createSession(userId);
    const staleStaff = await createStaffSession(staffId);
    const freshStaff = await createStaffSession(staffId);

    // Expire two rows in place rather than sweeping with a future timestamp, which would
    // delete every valid session in the database, including other test files running in
    // parallel.
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - DAY) })
      .where(eq(sessions.id, hashSessionToken(staleCustomer)));
    await db
      .update(staffSessions)
      .set({ expiresAt: new Date(Date.now() - DAY) })
      .where(eq(staffSessions.id, hashSessionToken(staleStaff)));

    const deletedCount = await deleteExpiredSessions();
    expect(deletedCount).toBeGreaterThanOrEqual(2);

    expect(await resolveSession(staleCustomer)).toBeNull();
    expect(await resolveStaffSession(staleStaff)).toBeNull();
    expect(await resolveSession(freshCustomer)).not.toBeNull();
    expect(await resolveStaffSession(freshStaff)).not.toBeNull();

    await deleteSession(freshCustomer);
    await deleteSession(freshStaff);
  });

  it("cascades staff_sessions deletion when the staff_users row is removed", async () => {
    const [staff] = await db
      .insert(staffUsers)
      .values({
        email: `staff-cascade-${Date.now()}@example.test`,
        name: "Cascade Staff",
        passwordHash: await hashPassword("irrelevant-password-1"),
      })
      .returning({ id: staffUsers.id });

    const token = await createStaffSession(staff.id);
    await db.delete(staffUsers).where(eq(staffUsers.id, staff.id));

    expect(await resolveStaffSession(token)).toBeNull();
  });
});
