import "server-only";

/**
 * Session persistence — the database half of authentication (architecture §Auth).
 *
 * Deliberately free of `next/headers`, so the security-critical behaviour (hash lookup,
 * expiry, sliding renewal, revocation) can be exercised directly against a real database
 * in integration tests. The cookie layer lives in `session.ts` on top of this.
 */
import { and, eq, isNull, lt, ne } from "drizzle-orm";

import { db } from "@/src/db";
import { organizations, sessions, staffSessions, staffUsers, users } from "@/src/db/schema";
import type { OrgPlan, UserRole } from "@/src/db/schema";

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
  /**
   * The signed-in person's display name, for the header's profile menu. Nullable for the same
   * reason the column is: an account created before the column exists has no name on file, and
   * every reader falls back to the email rather than inventing one.
   *
   * Optional rather than required so the many test fixtures that build a session literal do
   * not each have to state a field none of them exercises. The real session always sets it,
   * and an absent value takes the same email fallback a null one does.
   */
  userName?: string | null;
  /** Storage key of the profile photo, null until one is uploaded. */
  avatarKey?: string | null;
  role: UserRole;
  orgName: string;
  /** The org's plan (Phase 9). Carried on the session because the app header renders a badge
   *  for the AI plan on every page, and a second query per request for one enum is waste. */
  plan: OrgPlan;
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

/** AB Solutions staff — no org, no role (Phase 9, D-98). */
export type StaffSessionContext = {
  staffId: string;
  email: string;
  name: string;
};

export type ResolvedStaffSession = {
  context: StaffSessionContext;
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
 *
 * Also returns null once `organizations.suspended_at` is set (Phase 9, D-99): this is the one
 * place every page, server action and `app/api/*` route passes through on the way to a
 * `SessionContext`, so the filter here is what makes suspension take effect immediately for
 * all of them, with no per-caller change. Suspending also deletes the org's `sessions` rows in
 * the same transaction, so a token that survived a race still resolves to null here.
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
      userName: users.name,
      avatarKey: users.avatarKey,
      role: users.role,
      orgId: organizations.id,
      orgName: organizations.name,
      plan: organizations.plan,
      docName: organizations.docName,
      activeMonth: organizations.activeMonth,
      activeFundingSourceId: organizations.activeFundingSourceId,
      onboardedAt: organizations.onboardedAt,
      welcomeDismissedAt: organizations.welcomeDismissedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizations, eq(organizations.id, users.orgId))
    // `deactivatedAt` here as well as deleting the sessions at revocation time: the delete is
    // what ends access immediately, and this is what makes it impossible for any cookie to
    // outlive the revocation if a session row is ever created or restored another way.
    .where(
      and(
        eq(sessions.id, tokenHash),
        isNull(organizations.suspendedAt),
        isNull(users.deactivatedAt),
      ),
    )
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
      userName: row.userName,
      avatarKey: row.avatarKey,
      role: row.role,
      orgName: row.orgName,
      plan: row.plan,
      docName: row.docName,
      activeMonth: row.activeMonth,
      activeFundingSourceId: row.activeFundingSourceId,
      onboarded: row.onboardedAt !== null,
      welcomeDismissed: row.welcomeDismissedAt !== null,
    },
  };
}

/** Create a staff session row and return the raw token for the cookie. */
export async function createStaffSession(staffId: string, now: Date = new Date()): Promise<string> {
  const token = generateSessionToken();
  await db.insert(staffSessions).values({
    id: hashSessionToken(token),
    staffUserId: staffId,
    expiresAt: sessionExpiry(now),
  });
  return token;
}

/**
 * Look up a staff session by its cookie token. Same expiry / max-age / sliding-renewal rules
 * as `resolveSession`, joined `staff_sessions` → `staff_users` only — a customer token can
 * never resolve here (Phase 9, D-98).
 */
export async function resolveStaffSession(
  token: string,
  now: Date = new Date(),
): Promise<ResolvedStaffSession | null> {
  const tokenHash = hashSessionToken(token);

  const rows = await db
    .select({
      expiresAt: staffSessions.expiresAt,
      createdAt: staffSessions.createdAt,
      staffId: staffUsers.id,
      email: staffUsers.email,
      name: staffUsers.name,
    })
    .from(staffSessions)
    .innerJoin(staffUsers, eq(staffUsers.id, staffSessions.staffUserId))
    .where(eq(staffSessions.id, tokenHash))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (isExpired(row.expiresAt, now) || exceedsMaxAge(row.createdAt, now)) {
    await db.delete(staffSessions).where(eq(staffSessions.id, tokenHash));
    return null;
  }

  let renewed = false;
  if (needsRenewal(row.expiresAt, now)) {
    await db
      .update(staffSessions)
      .set({ expiresAt: sessionExpiry(now) })
      .where(eq(staffSessions.id, tokenHash));
    renewed = true;
  }

  return {
    renewed,
    context: { staffId: row.staffId, email: row.email, name: row.name },
  };
}

/** Delete one session (sign out). Covers both `sessions` and `staff_sessions` — a token lives
 *  in exactly one table, so deleting from both needs no lookup to know which. */
export async function deleteSession(token: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  await db.delete(sessions).where(eq(sessions.id, tokenHash));
  await db.delete(staffSessions).where(eq(staffSessions.id, tokenHash));
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

/** Housekeeping for the nightly sweep. Sweeps both `sessions` and `staff_sessions`. */
export async function deleteExpiredSessions(now: Date = new Date()): Promise<number> {
  const deleted = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
  const deletedStaff = await db
    .delete(staffSessions)
    .where(lt(staffSessions.expiresAt, now))
    .returning({ id: staffSessions.id });
  return deleted.length + deletedStaff.length;
}
