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
  const { hashSessionToken, SESSION_TTL_MS } = await import("./tokens");

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
    expect(resolved!.context.activeMonth).toBe("2026-02");
    expect(resolved!.context.onboarded).toBe(false);
    expect(resolved!.renewed).toBe(false);

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

  it("sweeps expired rows", async () => {
    const token = await createSession(userId);
    const afterExpiry = new Date(Date.now() + SESSION_TTL_MS + DAY);

    expect(await deleteExpiredSessions(afterExpiry)).toBeGreaterThanOrEqual(1);
    expect(await resolveSession(token)).toBeNull();
  });

  it("cascades session deletion when the user is removed", async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Cascade Org", docName: "Cascade", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    const [user] = await db
      .insert(users)
      .values({ orgId: org.id, email: `cascade-${Date.now()}@example.test`, passwordHash: "x" })
      .returning({ id: users.id });

    const token = await createSession(user.id);
    await db.delete(organizations).where(eq(organizations.id, org.id));

    expect(await resolveSession(token)).toBeNull();
  });
});
