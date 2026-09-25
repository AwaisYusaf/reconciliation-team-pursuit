import "server-only";

/**
 * The session every server action starts with.
 *
 * A `"use server"` module may only export async actions, so each module previously declared
 * its own private copy of this. It lives here instead: one definition of what an expired
 * session looks like to a form, rather than five that have to be kept in agreement.
 */
import { UI } from "@/src/domain/strings";
import { fail, SESSION_EXPIRED, type ActionResult } from "@/src/lib/action-result";
import { getSession, getStaffSession, requireSession, UnauthenticatedError } from "@/src/services/auth/session";
import { hasPaidAccess } from "@/src/services/auth/entitlement";
import type { SessionContext, StaffSessionContext } from "@/src/services/auth/store";

export type ActionSession = SessionContext | { expired: ActionResult<never> };

/**
 * Returns the session, or a ready-made failure the action can return straight to the form.
 *
 * An expired session is a normal outcome — the cookie has a 30-day sliding window and the
 * tab may have been open longer — so it is answered with a message rather than an exception.
 *
 * This does **not** check billing (Phase 15): it is the base every action, paid or not,
 * eventually goes through. Use it directly only for an allow-listed entry (§4.7); everything
 * else calls the guarded `actionSession()` below.
 */
export async function actionSessionAnyPlan(): Promise<ActionSession> {
  try {
    return await requireSession();
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { expired: fail(SESSION_EXPIRED) };
    throw error;
  }
}

/**
 * `actionSessionAnyPlan()`, refused for an organization without paid access (Phase 15, C6).
 *
 * The refusal reuses the `expired` key rather than a new one: about 70 call sites across the
 * app check `"expired" in session`, and giving unpaid orgs their own key would mean editing
 * every one of them to also treat it as "stop, show this message". This is a refusal before the
 * action runs, never a thrown error — same reasoning as the expired-session case above.
 */
export async function actionSession(): Promise<ActionSession> {
  const session = await actionSessionAnyPlan();
  if ("expired" in session) return session;
  if (!hasPaidAccess(session)) return { expired: fail(UI.billingPlanRequired) };
  return session;
}

export const FORBIDDEN = "You do not have permission to do that.";

export type AdminSession = SessionContext | { denied: ActionResult<never> };

/**
 * Admin-only variant of `actionSessionAnyPlan()` — no billing check (Phase 15 §4.7 allow-list).
 *
 * A manager reaching a user-management action is answered with a typed failure, not a thrown
 * error: server actions are directly invocable, so this is the real enforcement point and it
 * has to behave like every other refusal the forms already render.
 *
 * A distinct `denied` key rather than reusing `expired`, so a forbidden result is never
 * mistaken for a signed-out one by a caller that only checks `"expired" in x`.
 */
export async function requireAdminAnyPlan(): Promise<AdminSession> {
  const session = await actionSessionAnyPlan();
  if ("expired" in session) return { denied: session.expired };
  if (session.role !== "admin") return { denied: fail(FORBIDDEN) };
  return session;
}

/**
 * `requireAdminAnyPlan()`, also refused for an organization without paid access (Phase 15). The
 * plan check runs first: an unpaid manager and an unpaid admin see the same billing message,
 * rather than the admin-only one that would otherwise leak nothing but is still the wrong reason.
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
