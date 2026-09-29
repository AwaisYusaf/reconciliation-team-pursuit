import Link from "next/link";

import { WelcomeBanner } from "@/src/components/app-shell/welcome-banner";
import {
  EmptyState,
  PageTitle,
  Subtext,
} from "@/src/components/ui/surfaces";
import { TourGuide } from "@/src/components/ui/tour";
import { monthLabel } from "@/src/domain/dates";
import { pageTitle } from "@/src/domain/strings";
import { greetingName } from "@/src/domain/user-display";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadReadySummarySourceIds } from "@/src/modules/monthly-summary/queries";
import { DASHBOARD_TOUR_STEPS } from "@/src/modules/tours/dashboard-tour";
import { hasSeenTour } from "@/src/modules/tours/queries";
import { pageSession } from "@/src/lib/page-session";
import { SourceBudgetSection } from "./source-budget-section";

export const metadata = { title: pageTitle("Dashboard") };

/**
 * m01 — budget status per line item for the active month.
 *
 * Every figure comes from the shared calculation service, so this table and the contract
 * summary can never disagree (R10.2). Renders one `SourceBudgetSection` per funding source
 * shown (Phase 5).
 */
export default async function DashboardPage() {
  const session = await pageSession();

  const { selectedId, sources, activeSources, single } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );
  const month = session.activeMonth;
  const greeting = greetingName(session.userName, session.email);
  const seenDashboardTour = await hasSeenTour(session.userId, "dashboard");
  const selected = selectedId ? sources.find((s) => s.id === selectedId) : undefined;
  // One source selected (or a single-source org, where `selectedId` is always that source):
  // render just that one section. With "All" selected, render one section per ACTIVE source,
  // in `sort_order` (`listFundingSources` orders by sortOrder, name, id; `activeSources`
  // preserves that order). There is deliberately no combined total anywhere: different
  // funders' money is not one budget (Appendix A §5).
  const shown = selected ? [selected] : activeSources;
  // Batched once here, not per section (no N+1) — see `loadReadySummarySourceIds`'s own doc.
  const readySummaryIds = await loadReadySummarySourceIds(
    session.orgId,
    shown.map((s) => s.id),
    month,
  );

  return (
    <div>
      <TourGuide tour="dashboard" steps={DASHBOARD_TOUR_STEPS} alreadySeen={seenDashboardTour} />
      {/*
        The month line sits above the greeting rather than under it. It is the one fact that
        changes what every figure below means, so it reads first; the greeting names the
        person and carries no information, so it reads second and large.
      */}
      <Subtext className="mb-1">Budget status for {monthLabel(month)}.</Subtext>
      <PageTitle className="mb-5 sm:mb-6">
        {greeting ? `Welcome, ${greeting}!` : "Welcome!"}
      </PageTitle>

      {!session.welcomeDismissed && <WelcomeBanner />}

      {shown.length === 0 ? (
        <EmptyState>
          No active funding sources. Add one in{" "}
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
            summaryReady={readySummaryIds.has(source.id)}
            selectedId={selectedId}
          />
        ))
      )}
    </div>
  );
}
