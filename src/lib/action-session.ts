import "server-only";

/**
 * The session every server action starts with.
 *
 * A `"use server"` module may only export async actions, so each module previously declared
 * its own private copy of this. It lives here instead: one definition of what an expired
 * session looks like to a form, rather than five that have to be kept in agreement.
 */
import { fail, SESSION_EXPIRED, type ActionResult } from "@/src/lib/action-result";
import { requireSession, UnauthenticatedError } from "@/src/services/auth/session";
import type { SessionContext } from "@/src/services/auth/store";

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
