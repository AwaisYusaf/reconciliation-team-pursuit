import { notFound } from "next/navigation";

import { formatDateShort, monthLabel, type MonthKey, todayIso } from "@/src/domain/dates";
import { loadMonthlySummaryScreen, loadViewerDisplay } from "@/src/modules/monthly-summary/queries";

import { SavedSummaries, type SavedSummaryRow } from "./saved-summaries";
import { SummaryEditor } from "./summary-editor";

/**
 * Everything the Monthly summary screen and the Month-End Packet tab both need to render one
 * funding source's month (Phase 11 §7.1, §7.5; PR #18 review #7 — one component, one loader,
 * on both surfaces rather than two drifting copies). A Server Component so both callers stay
 * server-rendered up to the same client boundary (`SummaryEditor`).
 *
 * `null` from `loadMonthlySummaryScreen` — an invalid month key or a source not owned by this
 * org — is treated as "not found" here, same as `/r/monthly-summary/page.tsx` always has, so
 * moving this logic doesn't change that screen's 404 behaviour for older months and deep links.
 */
export async function MonthlySummarySection({
  orgId,
  userId,
  email,
  fundingSourceId,
  month,
}: {
  orgId: string;
  userId: string;
  email: string;
  fundingSourceId: string;
  month: MonthKey;
}) {
  const [screen, viewerName] = await Promise.all([
    loadMonthlySummaryScreen(orgId, fundingSourceId, month),
    loadViewerDisplay(userId, email),
  ]);
  if (!screen) notFound();

  const label = monthLabel(month);
  const todayLabel = formatDateShort(todayIso());

  const savedMonths: SavedSummaryRow[] = screen.savedMonths.map((row) => ({
    month: row.month,
    monthLabel: monthLabel(row.month),
    date: formatDateShort(todayIso(row.editedAt ?? row.writtenAt)),
    edited: row.editedAt !== null,
  }));

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start gap-6 lg:gap-8">
      <div className="min-w-0">
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

      <div className="min-w-0">
        <SavedSummaries rows={savedMonths} activeMonth={month} />
      </div>
    </div>
  );
}
