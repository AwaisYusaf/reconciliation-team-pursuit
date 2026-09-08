import { redirect } from "next/navigation";

import { getSession } from "@/src/services/auth/session";

/**
 * Admin scaffold. Authentication is real here — `getSession()` is the security boundary,
 * same as `/r` — but there is no admin authorization: the session/user schema has no role
 * or admin flag today (verified: nothing in `src/db/schema.ts`).
 *
 * TODO: any signed-in user currently reaches `/a`. A role check must land before real
 * admin functionality does.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return <>{children}</>;
}
