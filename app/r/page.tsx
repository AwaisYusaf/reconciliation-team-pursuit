import Link from "next/link";

import { WelcomeBanner } from "@/src/components/app-shell/welcome-banner";
import { EmptyState, PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { TourGuide } from "@/src/components/ui/tour";
import { monthLabel } from "@/src/domain/dates";
import { waitingDraftTotals } from "@/src/domain/draft-rules";
import { pageTitle, UI } from "@/src/domain/strings";
import { greetingName } from "@/src/domain/user-display";
import { aiAllowedForOrg, readAmountsAllowedForOrg } from "@/src/modules/ai/access";
import { orgHasAnyExpense } from "@/src/modules/dashboard/queries";
import { loadMonthDrafts } from "@/src/modules/expense-imports/queries";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadReadySummarySourceIds } from "@/src/modules/monthly-summary/queries";
import { loadLockedMonths } from "@/src/modules/packet/queries";
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
 *
 * Usability round 1: the title reads "Welcome, {name}!" for everyone (#17). The welcome banner
 * shows only until the person dismisses it or the organization has any expense at all (#52). An
 * organization whose plan includes AI gets one calm note saying what it does, naming receipt
 * reading and invoices only while AI reading is on (#56). Each section reminds how many drafts
 * are waiting for review this month and links to them, saying why they can't be approved when
 * that source's month is locked (#64); drafts still count in no figure (PHASE-14 §6).
 */
export default async function DashboardPage() {
  const session = await pageSession();

  const { selectedId, sources, activeSources, single } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );
  const month = session.activeMonth;
  const greeting = greetingName(session.userName, session.email);
  const selected = selectedId ? sources.find((s) => s.id === selectedId) : undefined;
  // One source selected (or a single-source org, where `selectedId` is always that source):
  // render just that one section. With "All" selected, render one section per ACTIVE source,
  // in `sort_order` (`listFundingSources` orders by sortOrder, name, id; `activeSources`
  // preserves that order). There is deliberately no combined total anywhere: different
  // funders' money is not one budget (Appendix A §5).
  const shown = selected ? [selected] : activeSources;
  // Batched once here, not per section (no N+1) — see `loadReadySummarySourceIds`'s own doc.
  // The drafts are read once for the header's scope and grouped per source below, for the
  // same reason.
  const [seenDashboardTour, readySummaryIds, hasExpense, aiOn, drafts, readingOn, lockedMonths] = await Promise.all([
    hasSeenTour(session.userId, "dashboard"),
    loadReadySummarySourceIds(
      session.orgId,
      shown.map((s) => s.id),
      month,
    ),
    // Not asked at all once dismissed: the banner is gone either way.
    session.welcomeDismissed ? Promise.resolve(true) : orgHasAnyExpense(session.orgId),
    aiAllowedForOrg(session.orgId),
    loadMonthDrafts(session.orgId, selectedId, month),
    readAmountsAllowedForOrg(session.orgId),
    loadLockedMonths(session.orgId, selectedId),
  ]);
  const draftTotals = waitingDraftTotals(drafts);

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

      {/* The AI line rides on the first-run banner (#56): shown once, not a tile every visit. */}
      {!session.welcomeDismissed && !hasExpense && (
        <WelcomeBanner
          aiLine={aiOn ? (readingOn ? UI.dashboardAiIntro : UI.dashboardAiIntroSummaryOnly) : undefined}
        />
      )}

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
            waitingDrafts={draftTotals.get(source.id) ?? null}
            monthLocked={lockedMonths.has(`${source.id}:${month}`)}
          />
        ))
      )}
    </div>
  );
}
