import { notFound, redirect } from "next/navigation";

import { PickFundingSource } from "@/src/components/app-shell/pick-funding-source";
import { PageHeader } from "@/src/components/ui/surfaces";
import { PlusBadge } from "@/src/components/ui/plus-badge";
import { formatDateShort, monthLabel, todayIso } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { summariesAccessForOrg } from "@/src/modules/ai/access";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadMonthlySummaryScreen, loadViewerDisplay } from "@/src/modules/monthly-summary/queries";
import { getSession } from "@/src/services/auth/session";

import { SavedSummaries, type SavedSummaryRow } from "./saved-summaries";
import { SummaryEditor } from "./summary-editor";

export const metadata = { title: "Monthly Summary — Grant Expense Reconciliation" };

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
        <PageHeader title={<Titled />} />
        <p className="text-[15px] text-ink">{UI.summaryPlanNote}</p>
      </div>
    );
  }

  const { selectedId: fundingSourceId, activeSources, sources } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );
  const month = session.activeMonth;
  const label = monthLabel(month);

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

  const [screen, viewerName] = await Promise.all([
    loadMonthlySummaryScreen(session.orgId, fundingSourceId, month),
    loadViewerDisplay(session.userId, session.email),
  ]);
  if (!screen) notFound();

  const todayLabel = formatDateShort(todayIso());

  const savedMonths: SavedSummaryRow[] = screen.savedMonths.map((row) => ({
    month: row.month,
    monthLabel: monthLabel(row.month),
    date: formatDateShort(todayIso(row.editedAt ?? row.writtenAt)),
    edited: row.editedAt !== null,
  }));

  return (
    <div>
      <PageHeader title={<Titled />} />

      {/* Flex column below lg so `order` puts the saved list above the editor on phone and
          tablet; beside it on desktop. */}
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start gap-6 lg:gap-8">
        <div className="min-w-0 order-2 lg:order-1">
          {/* Keyed so switching month or source remounts: the autosave scheduler (and its save
              target) is created once per mount. */}
          <SummaryEditor
            key={`${fundingSourceId}:${month}`}
            sourceId={fundingSourceId}
            month={month}
            monthLabel={label}
            canWrite={screen.access.write}
            hasExpenses={screen.liveExpenseCount > 0}
            initialWriting={screen.writing}
            summary={
              screen.summary
                ? {
                    contentMarkdown: screen.summary.contentMarkdown,
                    version: screen.summary.version,
                    writtenAtLabel: formatDateShort(todayIso(screen.summary.writtenAt)),
                    editedAtLabel: screen.summary.editedAt
                      ? formatDateShort(todayIso(screen.summary.editedAt))
                      : null,
                    editedByName: screen.summary.editedByName,
                  }
                : null
            }
            stale={screen.stale}
            viewerName={viewerName}
            todayLabel={todayLabel}
          />
        </div>

        <div className="min-w-0 order-1 lg:order-2">
          <SavedSummaries rows={savedMonths} activeMonth={month} />
        </div>
      </div>
    </div>
  );
}

function Titled() {
  return (
    <span className="inline-flex items-center gap-2.5">
      {UI.summaryTitle}
      <PlusBadge />
    </span>
  );
}
