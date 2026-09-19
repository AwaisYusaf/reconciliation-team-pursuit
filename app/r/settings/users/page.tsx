import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/src/components/ui/surfaces";
import { pageTitle } from "@/src/domain/strings";
import { listOrgUsersAction } from "@/src/modules/users/actions";
import { getSession } from "@/src/services/auth/session";

import { UsersManager } from "./users-manager";

export const metadata = { title: pageTitle("Users") };

export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // The action itself re-checks this — this redirect is UI-hiding only, not the security
  // boundary. A manager who reaches this URL directly never sees the page at all.
  if (session.role !== "admin") redirect("/r/settings");

  const result = await listOrgUsersAction();

  return (
    <div>
      <PageHeader
        title="Users"
        subtext="Everyone who can sign in to this organization."
        actions={
          <Link href="/r/settings" className="text-[15px] text-accent underline hover:text-accent-dark">
            Back to Settings
          </Link>
        }
      />

      {result.ok ? <UsersManager users={result.data} /> : <p className="text-[15px] text-danger">{result.error}</p>}
    </div>
  );
}
