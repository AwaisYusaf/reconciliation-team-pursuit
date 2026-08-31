import { redirect } from "next/navigation";

import { AppNav } from "@/src/components/app-shell/app-nav";
import { MonthSelector } from "@/src/components/app-shell/month-selector";
import { Button } from "@/src/components/ui/button";
import { AppToaster } from "@/src/components/ui/toast";
import { loadSelectableMonths } from "@/src/db/months";
import { signOutAction } from "@/src/modules/auth/actions";
import { getSession } from "@/src/services/auth/session";

/**
 * The authenticated shell every feature screen renders inside (m00).
 *
 * Authentication happens here rather than in `proxy.ts`: middleware only improves
 * redirect UX and is never the security boundary.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.onboarded) redirect("/onboarding/line-items");

  // One list, shared with the expense form: a month the header can select must also be a
  // month an expense can be moved into.
  const months = await loadSelectableMonths(session.orgId, [session.activeMonth]);
  const activeMonth = session.activeMonth;

  return (
    <div className="min-h-screen bg-paper">
      <header className="no-print">
        <div className="bg-surface border-b border-line px-4 sm:px-6 py-3 sm:py-[18px] flex gap-4 items-center justify-between">
          <div className="min-w-0">
            {/* Truncates rather than wrapping: a long organisation name would otherwise push
                the log-out control onto its own row on a phone. */}
            <div className="font-serif text-lg sm:text-xl lg:text-2xl font-bold leading-tight text-ink truncate">
              {session.orgName}
            </div>
            <div className="text-[13px] sm:text-[15px] text-sub mt-0.5 sm:mt-1 truncate">
              Grant Expense Reconciliation
            </div>
          </div>
          <form action={signOutAction} className="shrink-0">
            <Button type="submit" variant="secondary" className="min-h-11 sm:min-h-12 text-[15px]">
              Log out
            </Button>
          </form>
        </div>

        <div className="bg-surface border-b border-line px-4 sm:px-6 pt-3 sm:pt-4">
          <div className="max-w-[1100px] mx-auto">
            <MonthSelector months={months} activeMonth={activeMonth} />
            <AppNav />
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-12 sm:pb-16">
        {children}
      </main>
      <AppToaster />
    </div>
  );
}
