import Link from "next/link";
import { redirect } from "next/navigation";

import { WelcomeBanner } from "@/src/components/app-shell/welcome-banner";
import { EmptyState, PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { TourGuide } from "@/src/components/ui/tour";
import { monthLabel } from "@/src/domain/dates";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { DASHBOARD_TOUR_STEPS } from "@/src/modules/tours/dashboard-tour";
import { hasSeenTour } from "@/src/modules/tours/queries";
import { getSession } from "@/src/services/auth/session";
import { SourceBudgetSection } from "./source-budget-section";

export const metadata = { title: "Dashboard — Grant Expense Reconciliation" };

/**
 * m01 — budget status per line item for the active month.
 *
 * Every figure comes from the shared calculation service, so this table and the contract
 * summary can never disagree (R10.2). Renders one `SourceBudgetSection` per funding source
 * shown (Phase 5).
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { selectedId, sources, activeSources, single } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );
  const month = session.activeMonth;
  const seenDashboardTour = await hasSeenTour(session.userId, "dashboard");
  const selected = selectedId ? sources.find((s) => s.id === selectedId) : undefined;
  // One source selected (or a single-source org, where `selectedId` is always that source):
  // render just that one section. With "All" selected, render one section per ACTIVE source,
  // in `sort_order` (`listFundingSources` orders by sortOrder, name, id; `activeSources`
  // preserves that order). There is deliberately no combined total anywhere: different
  // funders' money is not one budget (Appendix A §5).
  const shown = selected ? [selected] : activeSources;

  return (
    <div>
      <TourGuide tour="dashboard" steps={DASHBOARD_TOUR_STEPS} alreadySeen={seenDashboardTour} />
      <PageTitle className="mb-1.5">Dashboard</PageTitle>
      <Subtext className="mb-[26px]">Budget status for {monthLabel(month)}.</Subtext>

      {!session.welcomeDismissed && <WelcomeBanner />}

      {shown.length === 0 ? (
        <EmptyState>
          No active funding sources — add one in{" "}
          <Link href="/r/settings" className="text-accent underline">
            Settings
          </Link>
          .
        </EmptyState>
      ) : (
        shown.map((source) => (
          <SourceBudgetSection
            key={source.id}
            orgId={session.orgId}
            source={source}
            month={month}
            showTitle={!single}
          />
        ))
      )}
    </div>
  );
}
