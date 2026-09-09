import { redirect } from "next/navigation";

import { getSession } from "@/src/services/auth/session";

/**
 * Admin scaffold. Authentication is real here — `getSession()` is the security boundary,
 * same as `/r` — and now so is authorization: `/a` is for `admin` accounts only, same
 * `users.role` check `requireAdmin()` uses in server actions.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/r");

  return <>{children}</>;
}
