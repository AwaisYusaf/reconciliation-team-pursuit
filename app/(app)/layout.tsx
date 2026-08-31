import { redirect } from "next/navigation";

import { AppNav } from "@/src/components/app-shell/app-nav";
import { MonthSelector } from "@/src/components/app-shell/month-selector";
import { Button } from "@/src/components/ui/button";
import { AppToaster } from "@/src/components/ui/toast";
import { db } from "@/src/db";
import { contractSettings, expenses } from "@/src/db/schema";
import { contractMonths, monthWindow } from "@/src/domain/dates";
import { signOutAction } from "@/src/modules/auth/actions";
import { getSession } from "@/src/services/auth/session";
import { eq } from "drizzle-orm";

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

  // Months holding data stay selectable even when they fall outside the rolling window.
  const [monthRows, contractRows] = await Promise.all([
    db
      .selectDistinct({ month: expenses.month })
      .from(expenses)
      .where(eq(expenses.orgId, session.orgId)),
    db
      .select({ start: contractSettings.contractStart, end: contractSettings.contractEnd })
      .from(contractSettings)
      .where(eq(contractSettings.orgId, session.orgId))
      .limit(1),
  ]);

  // The contract's own months are always selectable, so a multi-year contract reaches its
  // end without anyone adding months by hand — and extends itself the moment the end date
  // is edited on renewal (D-30).
  //
  // The persisted active month is included too, even when it sits outside everything else
  // (any month reached through "Other month…" that holds no data). Without it the header
  // would show one month while every page below rendered another.
  const months = monthWindow([
    ...contractMonths(contractRows[0]?.start, contractRows[0]?.end),
    ...monthRows.map((row) => row.month),
    session.activeMonth,
  ]);
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
