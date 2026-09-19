import { redirect } from "next/navigation";

import { PickFundingSource } from "@/src/components/app-shell/pick-funding-source";
import { PageHeader } from "@/src/components/ui/surfaces";
import { PlusBadge } from "@/src/components/ui/plus-badge";
import { pageTitle, UI } from "@/src/domain/strings";
import { summariesAccessForOrg } from "@/src/modules/ai/access";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { getSession } from "@/src/services/auth/session";

import { MonthlySummarySection } from "@/src/components/monthly-summary/summary-section";

export const metadata = { title: pageTitle(UI.summaryTitle) };

/**
 * The Monthly summary screen (Phase 11 §7.1). Follows the header's funding source and month,
 * like every other tab. Order of checks: plan access first (P15 — even on "All", a base-plan
 * org has nothing to ask a source picker for), then "All", then the real screen.
 */
export default async function MonthlySummaryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const access = await summariesAccessForOrg(session.orgId);
  if (!access.use) {
    return (
      <div>
        <PageHeader title={<Titled showBadge={false} />} />
        <p className="text-[15px] text-ink">{UI.summaryPlanNote}</p>
      </div>
    );
  }

  const { selectedId: fundingSourceId, activeSources, sources } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );
  const month = session.activeMonth;

  if (fundingSourceId === null) {
    return (
      <div>
        <PageHeader title={<Titled />} subtext={UI.summaryPickSource} />
        <PickFundingSource
          sources={activeSources}
          archivedSources={sources.filter((s) => s.archivedAt !== null)}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={<Titled />} />
      <MonthlySummarySection
        orgId={session.orgId}
        userId={session.userId}
        email={session.email}
        fundingSourceId={fundingSourceId}
        month={month}
      />
    </div>
  );
}

function Titled({ showBadge = true }: { showBadge?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {UI.summaryTitle}
      {showBadge && <PlusBadge />}
    </span>
  );
}
