import { redirect } from "next/navigation";

import { WelcomeBanner } from "@/src/components/app-shell/welcome-banner";
import { EmptyState, PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { monthLabel } from "@/src/domain/dates";
import { getSession } from "@/src/services/auth/session";

export const metadata = { title: "Dashboard — Grant Expense Reconciliation" };

/**
 * Dashboard shell. The budget table lands with m01; this renders the m00 pieces —
 * the first-run banner and the empty state — so the shell is complete on its own.
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div>
      <PageTitle className="mb-1.5">Dashboard</PageTitle>
      <Subtext className="mb-[26px]">Budget status for {monthLabel(session.activeMonth)}.</Subtext>

      {!session.welcomeDismissed && <WelcomeBanner />}

      <EmptyState>No expenses recorded for {monthLabel(session.activeMonth)} yet.</EmptyState>
    </div>
  );
}
