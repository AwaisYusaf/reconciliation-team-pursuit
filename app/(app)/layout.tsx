import { redirect } from "next/navigation";

import { AppNav } from "@/src/components/app-shell/app-nav";
import { MonthSelector } from "@/src/components/app-shell/month-selector";
import { Button } from "@/src/components/ui/button";
import { AppToaster } from "@/src/components/ui/toast";
import { db } from "@/src/db";
import { expenses } from "@/src/db/schema";
import { monthWindow } from "@/src/domain/dates";
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
  const monthRows = await db
    .selectDistinct({ month: expenses.month })
    .from(expenses)
    .where(eq(expenses.orgId, session.orgId));

  // The persisted active month is always selectable, even when it sits outside the rolling
  // window (any month reached through "Earlier month…" that holds no data). Without it the
  // header would show one month while every page below rendered another.
  const months = monthWindow([...monthRows.map((row) => row.month), session.activeMonth]);
  const activeMonth = session.activeMonth;

  return (
    <div className="min-h-screen bg-paper">
      <header className="no-print">
        <div className="bg-surface border-b border-line px-6 py-[18px] flex flex-wrap gap-4 items-start justify-between">
          <div>
            <div className="font-serif text-2xl font-bold leading-tight text-ink">
              {session.orgName}
            </div>
            <div className="text-[15px] text-sub mt-1">Grant Expense Reconciliation</div>
          </div>
          <form action={signOutAction}>
            <Button type="submit" variant="secondary" className="min-h-12 text-[15px]">
              Log out
            </Button>
          </form>
        </div>

        <div className="bg-surface border-b border-line px-6 pt-4">
          <div className="max-w-[1100px] mx-auto">
            <MonthSelector months={months} activeMonth={activeMonth} />
            <AppNav />
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 pt-8 pb-16">{children}</main>
      <AppToaster />
    </div>
  );
}
