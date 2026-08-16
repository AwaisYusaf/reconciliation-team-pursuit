import "server-only";

/**
 * Session access for pages and actions — the cookie half of authentication (D-06).
 *
 * `getSession()` is the single entry point every Server Component, Server Action and
 * Route Handler calls. Middleware (`proxy.ts`) only improves redirect UX and is never the
 * security boundary — see the Next.js middleware-bypass class of vulnerabilities.
 *
 * Persistence lives in `store.ts`, which has no `next/headers` dependency and is covered
 * by integration tests against a real database.
 */
import { cookies } from "next/headers";
import { cache } from "react";

import { createSession, deleteOtherSessions, deleteSession, resolveSession } from "./store";
import { SESSION_COOKIE, sessionCookieOptions } from "./tokens";

export type { SessionContext } from "./store";
import type { SessionContext } from "./store";

/** Thrown when an unauthenticated caller reaches a protected server function. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

/**
 * Thrown when a caller references a row belonging to a different organisation.
 * The message is deliberately indistinguishable from "not found" so a probe cannot
 * confirm that an id exists in another organisation.
 */
export class ForbiddenError extends Error {
  constructor() {
    super("Not found");
    this.name = "ForbiddenError";
  }
}

/**
 * Resolve the current session from the request cookie.
 *
 * Wrapped in React's `cache` so the several components and actions that need it during one
 * request share a single database round trip.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const resolved = await resolveSession(token);
  if (!resolved) return null;

  // Keep the cookie's lifetime in step with the database row, so an active user is never
  // signed out at 30 days from login. Setting a cookie is illegal while rendering a Server
  // Component, so this is allowed to fail quietly — renewal is retried on every request
  // until a Server Action makes it stick.
  if (resolved.renewed) {
    try {
      store.set(SESSION_COOKIE, token, sessionCookieOptions());
    } catch {
      // Read-only rendering context; refreshed on the next mutation.
    }
  }

  return resolved.context;
});

/** Session or bust — for server functions that must be authenticated. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}

/**
 * Assert that a row belongs to the session's organisation.
 *
 * Every read and write that accepts an id from the client passes through here, so a
 * guessed or stolen id from another organisation cannot be acted on. The two-org
 * integration suite probes every server surface against this.
 */
export function assertOrgAccess(
  session: SessionContext,
  rowOrgId: string | null | undefined,
): void {
  if (!rowOrgId || rowOrgId !== session.orgId) throw new ForbiddenError();
}

/* -------------------------------------------------------------- mutations */

/**
 * Start a session and set the cookie. Only callable from a Server Action or Route
 * Handler — Next.js forbids setting cookies while rendering.
 */
export async function startSession(userId: string): Promise<void> {
  const token = await createSession(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());
}

/** End the current session: delete the row, clear the cookie. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  store.delete(SESSION_COOKIE);
}

/** Revoke every other session for the signed-in user (password change, D-06). */
export async function revokeOtherSessions(userId: string): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  await deleteOtherSessions(userId, token);
}
