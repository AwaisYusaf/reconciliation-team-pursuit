import "server-only";

import { redirect } from "next/navigation";

import { getSession, getStaffSession, type StaffSessionContext } from "@/src/services/auth/session";

/**
 * The `/a` page gate (Phase 9, D-98). Every `/a` page calls this at the top, and the layout
 * calls it too to render the shell — Next 16 guidance is that layouts don't re-render on
 * navigation, so gating there alone would let a first render's check go stale.
 *
 * A signed-in customer (any role, including an org's own admin — the D-85 role check let
 * Misty in) is sent back to their own app rather than shown a 404, matching the product spec
 * ("as if the page didn't exist" is achieved by the redirect, not a not-found page). Signed
 * out goes to `/login`.
 */
export async function requireStaffPage(): Promise<StaffSessionContext> {
  const staff = await getStaffSession();
  if (staff) return staff;

  const customer = await getSession();
  if (customer) redirect(customer.onboarded ? "/r" : "/onboarding/line-items");

  redirect("/login");
}
