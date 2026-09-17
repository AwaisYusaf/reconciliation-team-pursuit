import "server-only";

/**
 * The session every server action starts with.
 *
 * A `"use server"` module may only export async actions, so each module previously declared
 * its own private copy of this. It lives here instead: one definition of what an expired
 * session looks like to a form, rather than five that have to be kept in agreement.
 */
import { fail, SESSION_EXPIRED, type ActionResult } from "@/src/lib/action-result";
import { getSession, getStaffSession, requireSession, UnauthenticatedError } from "@/src/services/auth/session";
import type { SessionContext, StaffSessionContext } from "@/src/services/auth/store";

export type ActionSession = SessionContext | { expired: ActionResult<never> };

/**
 * Returns the session, or a ready-made failure the action can return straight to the form.
 *
 * An expired session is a normal outcome — the cookie has a 30-day sliding window and the
 * tab may have been open longer — so it is answered with a message rather than an exception.
 */
export async function actionSession(): Promise<ActionSession> {
  try {
    return await requireSession();
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { expired: fail(SESSION_EXPIRED) };
    throw error;
  }
}

export const FORBIDDEN = "You do not have permission to do that.";

export type AdminSession = SessionContext | { denied: ActionResult<never> };

/**
 * Admin-only variant of `actionSession()`.
 *
 * A manager reaching a user-management action is answered with a typed failure, not a thrown
 * error: server actions are directly invocable, so this is the real enforcement point and it
 * has to behave like every other refusal the forms already render.
 *
 * A distinct `denied` key rather than reusing `expired`, so a forbidden result is never
 * mistaken for a signed-out one by a caller that only checks `"expired" in x`.
 */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await actionSession();
  if ("expired" in session) return { denied: session.expired };
  if (session.role !== "admin") return { denied: fail(FORBIDDEN) };
  return session;
}

export type StaffActionSession = StaffSessionContext | { denied: ActionResult<never> };

/**
 * Staff-only variant of `actionSession()`, for `/a` actions (Phase 9, D-98).
 *
 * Returns a typed failure rather than throwing, same reasoning as `requireAdmin()`: server
 * actions are directly invocable, so this is the real enforcement point. A signed-in customer
 * gets `FORBIDDEN` rather than `SESSION_EXPIRED` — they are authenticated, just not allowed
 * here, and "expired" would wrongly invite them to sign in again for an account that can
 * never reach this action.
 */
export async function requireStaff(): Promise<StaffActionSession> {
  const staff = await getStaffSession();
  if (staff) return staff;

  const customer = await getSession();
  if (customer) return { denied: fail(FORBIDDEN) };

  return { denied: fail(SESSION_EXPIRED) };
}
