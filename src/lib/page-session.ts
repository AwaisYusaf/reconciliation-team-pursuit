import "server-only";

/**
 * The session every `app/r/**` and onboarding page starts with (Phase 15 §4.7).
 *
 * Guarded by default: a page that calls `pageSession()` never renders for a signed-out or
 * unpaid organization, and never sends its data to the browser in the first place — a layout
 * alone still renders `children` before it can redirect (Next 16, `authentication.md:1352`).
 */
import { redirect } from "next/navigation";

import { hasPaidAccess } from "@/src/services/auth/entitlement";
import { getSession } from "@/src/services/auth/session";
import type { SessionContext } from "@/src/services/auth/store";

/** Signed in and paid, or redirected — never both a session and a refusal to render. */
export async function pageSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPaidAccess(session)) redirect("/r/plan");
  return session;
}

/**
 * The session `/r/plan` itself starts with. Never redirects a paid org back to `/r/plan` (that
 * would loop): a paid org is sent on into the app instead, same destination sign-in already uses.
 */
export async function planPageSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (hasPaidAccess(session)) redirect(session.onboarded ? "/r" : "/onboarding/line-items");
  return session;
}
