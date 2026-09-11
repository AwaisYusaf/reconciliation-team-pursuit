import "server-only";

/**
 * Session persistence — the database half of authentication (architecture §Auth).
 *
 * Deliberately free of `next/headers`, so the security-critical behaviour (hash lookup,
 * expiry, sliding renewal, revocation) can be exercised directly against a real database
 * in integration tests. The cookie layer lives in `session.ts` on top of this.
 */
import { and, eq, lt, ne } from "drizzle-orm";

import { db } from "@/src/db";
import { organizations, sessions, users } from "@/src/db/schema";
import type { UserRole } from "@/src/db/schema";

import {
  exceedsMaxAge,
  generateSessionToken,
  hashSessionToken,
  isExpired,
  needsRenewal,
  sessionExpiry,
} from "./tokens";

export type SessionContext = {
  userId: string;
  orgId: string;
  email: string;
  role: UserRole;
  orgName: string;
  docName: string;
  activeMonth: string;
  /** Header's current funding source selection (R2.3); null means "All" (Phase 6, D-93). */
  activeFundingSourceId: string | null;
  onboarded: boolean;
  welcomeDismissed: boolean;
};

export type ResolvedSession = {
  context: SessionContext;
  /** True when the sliding window fired, so the caller can re-issue the cookie. */
  renewed: boolean;
};

/** Create a session row for a user and return the raw token for the cookie. */
export async function createSession(userId: string, now: Date = new Date()): Promise<string> {
  const token = generateSessionToken();
  await db.insert(sessions).values({
    id: hashSessionToken(token),
    userId,
    expiresAt: sessionExpiry(now),
  });
  return token;
}

/**
 * Look up a session by its cookie token.
 *
 * Returns null for unknown or expired sessions; an expired row is deleted on the way out
 * so stale rows do not accumulate. A still-valid session inside its final 15 days has its
 * expiry pushed back to a full 30 days and is reported as `renewed`.
 */
export async function resolveSession(
  token: string,
  now: Date = new Date(),
): Promise<ResolvedSession | null> {
  const tokenHash = hashSessionToken(token);

  const rows = await db
    .select({
      expiresAt: sessions.expiresAt,
      createdAt: sessions.createdAt,
      userId: users.id,
      email: users.email,
      role: users.role,
      orgId: organizations.id,
      orgName: organizations.name,
      docName: organizations.docName,
      activeMonth: organizations.activeMonth,
      activeFundingSourceId: organizations.activeFundingSourceId,
      onboardedAt: organizations.onboardedAt,
      welcomeDismissedAt: organizations.welcomeDismissedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizations, eq(organizations.id, users.orgId))
    .where(eq(sessions.id, tokenHash))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // The sliding window has no end of its own: a session touched once a month renews forever.
  // The absolute cap is what eventually ends a cookie nobody knows was stolen.
  if (isExpired(row.expiresAt, now) || exceedsMaxAge(row.createdAt, now)) {
    await db.delete(sessions).where(eq(sessions.id, tokenHash));
    return null;
  }

  let renewed = false;
  if (needsRenewal(row.expiresAt, now)) {
    await db.update(sessions).set({ expiresAt: sessionExpiry(now) }).where(eq(sessions.id, tokenHash));
    renewed = true;
  }

  return {
    renewed,
    context: {
      userId: row.userId,
      orgId: row.orgId,
      email: row.email,
      role: row.role,
      orgName: row.orgName,
      docName: row.docName,
      activeMonth: row.activeMonth,
      activeFundingSourceId: row.activeFundingSourceId,
      onboarded: row.onboardedAt !== null,
      welcomeDismissed: row.welcomeDismissedAt !== null,
    },
  };
}

/** Delete one session (sign out). */
export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
}

/**
 * Delete every session for a user except the one holding `keepToken`.
 * Password change calls this: revocation is row deletion (D-06).
 */
export async function deleteOtherSessions(userId: string, keepToken?: string): Promise<void> {
  const keepId = keepToken ? hashSessionToken(keepToken) : null;
  await db
    .delete(sessions)
    .where(keepId ? and(eq(sessions.userId, userId), ne(sessions.id, keepId)) : eq(sessions.userId, userId));
}

/** Housekeeping for the nightly sweep. */
export async function deleteExpiredSessions(now: Date = new Date()): Promise<number> {
  const deleted = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
  return deleted.length;
}
