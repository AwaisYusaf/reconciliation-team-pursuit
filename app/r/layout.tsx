import { redirect } from "next/navigation";

import { AppNav } from "@/src/components/app-shell/app-nav";
import { FundingSourceSelector } from "@/src/components/app-shell/funding-source-selector";
import { MonthSelector } from "@/src/components/app-shell/month-selector";
import { TourReplayButton } from "@/src/components/app-shell/tour-replay-button";
import { Button } from "@/src/components/ui/button";
import { AppToaster } from "@/src/components/ui/toast";
import { loadSelectableMonths } from "@/src/db/months";
import { PlusBadge } from "@/src/components/ui/plus-badge";
import { aiPlanAllowed } from "@/src/modules/ai/access";
import { signOutAction } from "@/src/modules/auth/actions";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
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

  const { sources, selectedId, single } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );

  // One list, shared with the expense form: a month the header can select must also be a
  // month an expense can be moved into.
  const months = await loadSelectableMonths(session.orgId, selectedId, [session.activeMonth]);
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
          <div className="shrink-0 flex items-center gap-2.5">
            {/* Only the AI plan gets a badge: on the plain plan a badge saying so would be
                noise on every page, forever (Phase 9). */}
            {aiPlanAllowed(session.plan) && <PlusBadge />}
            <TourReplayButton />
            <form action={signOutAction}>
              <Button type="submit" variant="secondary" className="min-h-11 sm:min-h-12 text-[15px]">
                Log out
              </Button>
            </form>
          </div>
        </div>

        {/* No border-b here — this row and the sticky tab row right below it are both
            bg-surface, and a line between them made two white boxes read as separate bars
            stacked on top of each other instead of one continuous header surface. */}
        <div className="bg-surface px-4 sm:px-6 pt-3 sm:pt-4">
          <div className="max-w-[1220px] mx-auto flex flex-wrap gap-4">
            <div data-tour="month-selector">
              <MonthSelector months={months} activeMonth={activeMonth} />
            </div>
            {!single && (
              <div data-tour="funding-source-selector">
                <FundingSourceSelector sources={sources} selectedId={selectedId} />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Only the tab row sticks — the org name/log-out row and month selector scroll away
          normally, so this doesn't eat vertical space on a long screen, just stays reachable
          without scrolling back up. A sibling of `header`/`main`, not nested inside `header`:
          `position: sticky` can't hold an element past the bottom edge of its own immediate
          parent, and `header` is exactly as tall as its own rows — nesting the sticky nav as
          header's last child gave it nowhere to stick once header itself scrolled past the
          top of the viewport (confirmed live: after scrolling, the nav's top was -696px,
          dragged away with header instead of pinned at 0). Its parent here is this page's
          outermost wrapper, which spans the full page, so it has real room to stick in. */}
      <div className="no-print sticky top-0 z-30 bg-surface border-b border-line px-4 sm:px-6 pt-4 sm:pt-[18px]">
        <div className="max-w-[1220px] mx-auto">
          <AppNav />
        </div>
      </div>

      <main className="max-w-[1220px] mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-12 sm:pb-16">
        {children}
      </main>
      <AppToaster />
    </div>
  );
}
