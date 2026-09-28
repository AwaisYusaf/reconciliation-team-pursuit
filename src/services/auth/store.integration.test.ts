/**
 * Session persistence, exercised against a real Postgres database.
 *
 * Skipped automatically when DATABASE_URL is absent, so `npm test` stays green on a
 * machine without a database; CI and local development run the full suite.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("session store (integration)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, sessions, users } = await import("@/src/db/schema");
  const { createSession, deleteExpiredSessions, deleteOtherSessions, deleteSession, resolveSession } =
    await import("./store");
  const { hashSessionToken, SESSION_MAX_AGE_MS, SESSION_TTL_MS } = await import("./tokens");

  const DAY = 24 * 60 * 60 * 1000;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({
        name: "Integration Org",
        docName: "Integration",
        activeMonth: "2026-02",
      })
      .returning({ id: organizations.id });
    orgId = org.id;

    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `integration-${Date.now()}@example.test`,
        passwordHash: "unused-for-these-tests",
        role: "admin",
        // Deliberately not the org's "2026-02": the session must carry the person's own month.
        activeMonth: "2026-05",
      })
      .returning({ id: users.id });
    userId = user.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("resolves a fresh session and carries the organisation context", async () => {
    const token = await createSession(userId);
    const resolved = await resolveSession(token);

    expect(resolved).not.toBeNull();
    expect(resolved!.context.userId).toBe(userId);
    expect(resolved!.context.orgId).toBe(orgId);
    expect(resolved!.context.orgName).toBe("Integration Org");
    // The person's month, not the organization's (Phase 18, T7).
    expect(resolved!.context.activeMonth).toBe("2026-05");
    expect(resolved!.context.onboarded).toBe(false);
    expect(resolved!.renewed).toBe(false);

    await deleteSession(token);
  });

  it("gives a person who has never picked a month the current month and All (Phase 18, T3)", async () => {
    const [fresh] = await db
      .insert(users)
      .values({
        orgId,
        email: `integration-fresh-${Date.now()}@example.test`,
        passwordHash: "unused-for-these-tests",
        role: "manager",
      })
      .returning({ id: users.id });
    const token = await createSession(fresh.id);
    const now = new Date("2026-07-15T12:00:00Z");
    const resolved = await resolveSession(token, now);

    expect(resolved!.context.activeMonth).toBe("2026-07");
    expect(resolved!.context.activeFundingSourceId).toBeNull();

    await deleteSession(token);
  });

  it("stores only the token hash, so the database never holds the cookie value", async () => {
    const token = await createSession(userId);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, userId));

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(hashSessionToken(token));
    expect(rows[0].id).not.toBe(token);

    await deleteSession(token);
  });

  it("rejects an unknown or tampered token", async () => {
    expect(await resolveSession("not-a-real-token")).toBeNull();

    const token = await createSession(userId);
    expect(await resolveSession(`${token}x`)).toBeNull();
    await deleteSession(token);
  });

  it("rejects an expired session and deletes the row", async () => {
    const token = await createSession(userId);
    const future = new Date(Date.now() + SESSION_TTL_MS + DAY);

    expect(await resolveSession(token, future)).toBeNull();
    const remaining = await db.select().from(sessions).where(eq(sessions.id, hashSessionToken(token)));
    expect(remaining).toHaveLength(0);
  });

  it("rejects a session past the absolute max age and deletes the row, however often it was renewed", async () => {
    // There was no customer-side max-age test at all: the sliding window renews forever, so
    // this cap is the only thing that ends a cookie nobody knows was stolen (tokens.ts). The
    // expiry is pushed past the moment of the check first, so only `exceedsMaxAge` can reject.
    const token = await createSession(userId);
    const overMaxAge = new Date(Date.now() + SESSION_MAX_AGE_MS + DAY);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(overMaxAge.getTime() + 10 * DAY) })
      .where(eq(sessions.id, hashSessionToken(token)));

    expect(await resolveSession(token, overMaxAge)).toBeNull();
    const remaining = await db.select().from(sessions).where(eq(sessions.id, hashSessionToken(token)));
    expect(remaining).toHaveLength(0);
  });

  it("slides the expiry once the session enters its final 15 days", async () => {
    const token = await createSession(userId);
    const day20 = new Date(Date.now() + 20 * DAY);

    const resolved = await resolveSession(token, day20);
    expect(resolved!.renewed).toBe(true);

    const [row] = await db.select().from(sessions).where(eq(sessions.id, hashSessionToken(token)));
    // Expiry now measured from day 20, not from creation.
    expect(row.expiresAt.getTime()).toBeCloseTo(day20.getTime() + SESSION_TTL_MS, -4);

    await deleteSession(token);
  });

  it("signs out one device without touching the others", async () => {
    const [a, b] = [await createSession(userId), await createSession(userId)];

    await deleteSession(a);

    expect(await resolveSession(a)).toBeNull();
    expect(await resolveSession(b)).not.toBeNull();

    await deleteSession(b);
  });

  it("revokes every other session on password change, keeping the caller signed in", async () => {
    const keep = await createSession(userId);
    const other1 = await createSession(userId);
    const other2 = await createSession(userId);

    await deleteOtherSessions(userId, keep);

    expect(await resolveSession(keep)).not.toBeNull();
    expect(await resolveSession(other1)).toBeNull();
    expect(await resolveSession(other2)).toBeNull();

    await deleteSession(keep);
  });

  it("revokes all sessions when no token is kept", async () => {
    await createSession(userId);
    await createSession(userId);

    await deleteOtherSessions(userId);

    const rows = await db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("sweeps expired rows and leaves valid ones alone", async () => {
    const stale = await createSession(userId);
    const fresh = await createSession(userId);

    // Expire one row in place rather than sweeping with a future timestamp: a future
    // sweep would delete every valid session in the database, including those belonging
    // to other test files running in parallel.
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - DAY) })
      .where(eq(sessions.id, hashSessionToken(stale)));

    expect(await deleteExpiredSessions()).toBeGreaterThanOrEqual(1);
    expect(await resolveSession(stale)).toBeNull();
    expect(await resolveSession(fresh)).not.toBeNull();

    await deleteSession(fresh);
  });

  it("cascades session deletion when the user is removed", async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Cascade Org", docName: "Cascade", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    const [user] = await db
      .insert(users)
      .values({
        orgId: org.id,
        email: `cascade-${Date.now()}@example.test`,
        passwordHash: "x",
        role: "admin",
      })
      .returning({ id: users.id });

    const token = await createSession(user.id);
    await db.delete(organizations).where(eq(organizations.id, org.id));

    expect(await resolveSession(token)).toBeNull();
  });
});
