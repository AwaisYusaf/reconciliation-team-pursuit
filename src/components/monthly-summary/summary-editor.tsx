"use client";

/**
 * The Monthly summary screen's interactive part (Phase 11 §7.1–7.3). One component per
 * `${sourceId}:${month}` (the page keys it), so switching either remounts from scratch rather
 * than carrying stale text or a stale autosave scheduler across summaries.
 *
 * Two mutually exclusive branches, each owning its own "writing" fetch: before any summary
 * exists (`SummaryEditor` itself) and once one does (`SummaryBody`, which also owns the
 * autosave scheduler and Write again). `initialWriting` — another tab's run, reported by the
 * server — is read by both, since either branch can be the one showing while it finishes.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/src/components/ui/button";
import { ConfirmButton } from "@/src/components/ui/confirm-button";
import { DownloadButton } from "@/src/components/ui/download-button";
import { PLUS_FRAME_STYLE, SparkleIcon } from "@/src/components/ui/plus-badge";
import { Card, DangerPanel, InfoNote, SectionTitle } from "@/src/components/ui/surfaces";
import { toast } from "@/src/components/ui/toast";
import { draftsReviewHref } from "@/src/domain/draft-rules";
import { UI } from "@/src/domain/strings";
import { downloadBlock } from "@/src/modules/monthly-summary/autosave";
import { saveSummaryAction } from "@/src/modules/monthly-summary/actions";
import { copySummary, type ClipboardLike } from "@/src/modules/monthly-summary/copy";

import { SummaryRichEditor } from "./summary-rich-editor";
import { SummarySkeleton } from "./summary-skeleton";
import { useAutosave } from "./use-autosave";

export type SummaryEditorSummary = {
  contentMarkdown: string;
  version: number;
  writtenAtLabel: string;
  editedAtLabel: string | null;
  editedByName: string | null;
};

type WriteResponse =
  | { ok: true; data: { contentMarkdown: string; version: number; writtenBySomeoneElse: boolean } }
  | { ok: false; error: string };

async function requestWrite(body: {
  sourceId: string;
  month: string;
  expectedVersion: number | null;
}): Promise<WriteResponse> {
  try {
    const response = await fetch("/api/monthly-summary/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as WriteResponse;
  } catch {
    return { ok: false, error: UI.summaryWriteFailed };
  }
}

/** Drafts waiting for review in this source and month are not in the summary; says so, with a
 *  link to them (usability #65). Nothing when there are none. */
function DraftsWaitingNote({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <InfoNote className="mb-4">
      {UI.summaryDraftsWaiting(count)}{" "}
      <Link href={draftsReviewHref(null)} className="text-accent underline hover:text-accent-dark">
        {UI.draftsReviewLink}
      </Link>
    </InfoNote>
  );
}

export function SummaryEditor({
  sourceId,
  month,
  monthLabel,
  canWrite,
  hasExpenses,
  initialWriting,
  summary,
  stale,
  viewerName,
  todayLabel,
  waitingDrafts,
}: {
  sourceId: string;
  month: string;
  monthLabel: string;
  canWrite: boolean;
  hasExpenses: boolean;
  initialWriting: boolean;
  summary: SummaryEditorSummary | null;
  stale: boolean;
  viewerName: string;
  todayLabel: string;
  /** Drafts waiting for review in this source and month (usability #65). */
  waitingDrafts: number;
}) {
  const router = useRouter();
  // `summary` (the server prop) always wins once it's non-null: a background poll or another
  // tab's write (I-21, I-22) lands through a fresh `summary` on the next refresh, superseding
  // whatever this tab optimistically showed while its own request was in flight. The local
  // value only ever bridges the gap between "we just wrote the first draft" and that refresh
  // landing — it's never read once `summary` itself is populated.
  const [optimisticFirst, setOptimisticFirst] = useState<SummaryEditorSummary | null>(null);
  const current = summary ?? optimisticFirst;

  const [localWriting, setLocalWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const writing = localWriting || initialWriting;

  // Someone else's write is running: poll until it finishes, then the refreshed server props
  // carry the finished summary (§6).
  useEffect(() => {
    if (!initialWriting || localWriting) return;
    const id = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(id);
  }, [initialWriting, localWriting, router]);

  async function writeFirst() {
    setLocalWriting(true);
    setWriteError(null);
    const result = await requestWrite({ sourceId, month, expectedVersion: null });
    setLocalWriting(false);
    if (!result.ok) {
      setWriteError(result.error);
      return;
    }
    setOptimisticFirst({
      contentMarkdown: result.data.contentMarkdown,
      version: result.data.version,
      writtenAtLabel: todayLabel,
      editedAtLabel: null,
      editedByName: null,
    });
    router.refresh();
  }

  if (!current) {
    return (
      <Card style={PLUS_FRAME_STYLE} className="p-4 sm:p-5 lg:p-6">
        {/* The page title already says "Monthly summary"; the card names the month it is for. */}
        <SectionTitle className="mb-3">{monthLabel}</SectionTitle>
        <p className="text-[15px] text-ink leading-relaxed mb-4">{UI.summaryIntro(monthLabel)}</p>
        <DraftsWaitingNote count={waitingDrafts} />
        {writeError && <DangerPanel className="mb-4">{writeError}</DangerPanel>}
        {canWrite && (
          <>
            <Button disabled={!hasExpenses || writing} onClick={() => void writeFirst()}>
              {UI.summaryWriteButton}
            </Button>
            {!hasExpenses && <p className="mt-2.5 text-sm text-danger">{UI.summaryNoExpenses}</p>}
          </>
        )}
        {writing && (
          <p className="mt-2.5 text-[15px] text-sub" role="status" aria-live="polite">
            {UI.summaryWriting}
          </p>
        )}
      </Card>
    );
  }

  return (
    <SummaryBody
      sourceId={sourceId}
      month={month}
      monthLabel={monthLabel}
      canWrite={canWrite}
      serverWriting={initialWriting}
      summary={current}
      stale={stale}
      viewerName={viewerName}
      todayLabel={todayLabel}
      waitingDrafts={waitingDrafts}
    />
  );
}

function SummaryBody({
  sourceId,
  month,
  monthLabel,
  canWrite,
  serverWriting,
  summary,
  stale,
  viewerName,
  todayLabel,
  waitingDrafts,
}: {
  sourceId: string;
  month: string;
  monthLabel: string;
  canWrite: boolean;
  serverWriting: boolean;
  summary: SummaryEditorSummary;
  stale: boolean;
  viewerName: string;
  todayLabel: string;
  waitingDrafts: number;
}) {
  const router = useRouter();
  const [localWriting, setLocalWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const writing = localWriting || serverWriting;
  // Bumped to force the rich editor back to fresh `markdown` (Write again landing) without
  // going through its `onChange` — that would mark the new draft dirty and let autosave
  // immediately overwrite it.
  const [resetVersion, setResetVersion] = useState(0);

  const [editedLabel, setEditedLabel] = useState<{ date: string; name: string } | null>(
    summary.editedAtLabel ? { date: summary.editedAtLabel, name: summary.editedByName ?? "" } : null,
  );

  const scheduler = useAutosave({
    initialText: summary.contentMarkdown,
    initialVersion: summary.version,
    save: async (text, version) => {
      const result = await saveSummaryAction({ sourceId, month, markdown: text, expectedVersion: version });
      if (result.ok) setEditedLabel({ date: todayLabel, name: viewerName });
      return result;
    },
  });
  const snapshot = scheduler.getSnapshot();
  const block = downloadBlock(snapshot);

  async function handleWriteAgain() {
    // Read-only first, then hold saves: a pending edit is dropped (the confirm said so) and
    // nothing can bump the version under the write.
    setLocalWriting(true);
    setWriteError(null);
    const version = await scheduler.settle();
    const result = await requestWrite({ sourceId, month, expectedVersion: version });
    setLocalWriting(false);

    if (!result.ok) {
      if (result.error === UI.summaryConflict) {
        scheduler.markConflict();
      } else {
        scheduler.release();
        setWriteError(result.error);
      }
      return;
    }
    scheduler.reset(result.data.contentMarkdown, result.data.version);
    setEditedLabel(null);
    setResetVersion((v) => v + 1);
    router.refresh();
  }

  async function handleCopy() {
    const outcome = await copySummary(
      snapshot.text,
      typeof navigator !== "undefined" ? (navigator.clipboard as unknown as ClipboardLike) : undefined,
      typeof ClipboardItem !== "undefined" ? (parts) => new ClipboardItem(parts as Record<string, Blob>) : undefined,
    );
    if (outcome === "copied") toast.success(UI.summaryCopied);
    else toast.error(UI.summaryCopyRefused);
  }

  const statusText =
    snapshot.status === "saving"
      ? UI.summarySaving
      : snapshot.status === "saved"
        ? UI.summarySaved
        : snapshot.status === "failed"
          ? UI.summarySaveFailed
          : snapshot.status === "conflict"
            ? UI.summaryConflict
            : null;

  // A plain white card, like the paperwork it produces: the Plus frame suits a small panel, but
  // around a full page of text its gradient read as a muddy wash. The page title's Plus badge
  // already marks the tier.
  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="min-w-0">
          <SectionTitle className="mb-1">{monthLabel}</SectionTitle>
          <p className="text-[15px] text-sub">
            {UI.summaryMetaWritten(summary.writtenAtLabel)}
            {editedLabel && UI.summaryMetaEdited(editedLabel.date, editedLabel.name || null)}
          </p>
        </div>

        {/* Copy and download sit with the title: they are what a finished summary is for (PR #18
            round 2, #13). */}
        <div className="flex flex-wrap items-center gap-3">
          {block && (
            <span className="text-[15px] text-sub">
              {block === "saving" ? UI.summarySaving : UI.summaryDownloadUnsaved}
            </span>
          )}
          {/* Disabled while writing for the same reason as the downloads: the text on screen is
              about to be replaced. */}
          <Button variant="secondary" disabled={writing} onClick={() => void handleCopy()}>
            {UI.summaryCopyText}
          </Button>
          <DownloadButton
            variant="secondary"
            disabled={block !== null || writing}
            href={`/api/downloads/monthly-summary?source=${encodeURIComponent(sourceId)}&month=${encodeURIComponent(month)}&format=docx`}
          >
            {UI.summaryDownloadWord}
          </DownloadButton>
          <DownloadButton
            variant="secondary"
            disabled={block !== null || writing}
            href={`/api/downloads/monthly-summary?source=${encodeURIComponent(sourceId)}&month=${encodeURIComponent(month)}&format=pdf`}
          >
            {UI.summaryDownloadPdf}
          </DownloadButton>
        </div>
      </div>

      <div className="px-4 pt-4 pb-5 sm:px-6">
        {writeError && <DangerPanel className="mb-4">{writeError}</DangerPanel>}

        {stale && (
          <DangerPanel tone="notice" className="mb-4">
            {UI.summaryChangedNotice(monthLabel)}
          </DangerPanel>
        )}

        <DraftsWaitingNote count={waitingDrafts} />

        {/* A calm note, not an alert (PR #18 review #9) — red stays for the changed-records notice
            above and real errors; this is neither. */}
        <p className="flex items-start gap-2 rounded-[3px] bg-section px-3.5 py-2.5 text-[14px] text-sub mb-4">
          <SparkleIcon className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
          {UI.summaryAiReminder}
        </p>

        {/* While the model writes, the editor gives way to a shimmer: the text on screen is about
            to be replaced, so inviting edits to it would be a lie (user feedback 2026-09-18). */}
        {writing ? (
          <SummarySkeleton />
        ) : (
          <SummaryRichEditor
            markdown={snapshot.text}
            onChange={(next) => scheduler.edit(next)}
            readOnly={writing}
            resetVersion={resetVersion}
          />
        )}

        {/* The server's own reason (signed out, too long), above the Save row — the text stays. */}
        {snapshot.status === "failed" && snapshot.error && snapshot.error !== UI.summaryWriteFailed && (
          <p className="mt-2 text-[15px] text-danger">{snapshot.error}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 border-t border-line bg-paper rounded-b-[4px]">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={writing || !snapshot.dirty || snapshot.status === "saving" || snapshot.status === "conflict"}
            onClick={() => scheduler.saveNow()}
          >
            {UI.summarySave}
          </Button>
          <span role="status" aria-live="polite" className="text-[15px] text-sub">
            {statusText}
          </span>
          {snapshot.status === "failed" && (
            <Button variant="quiet" disabled={writing} onClick={() => scheduler.saveNow()}>
              {UI.summaryRetry}
            </Button>
          )}
        </div>

        {/* Rewriting throws the draft away, so it sits at the bottom as a secondary action, away
            from the everyday ones (PR #18 round 2, #13). While writing, the shimmer already says
            so; here the button simply goes quiet. */}
        {canWrite &&
          (writing ? (
            <Button variant="secondary" disabled>
              {UI.summaryWriteAgainButton}
            </Button>
          ) : (
            <ConfirmButton
              variant="secondary"
              title={UI.summaryWriteAgainTitle}
              body={UI.summaryWriteAgainBody}
              confirmLabel={UI.summaryWriteAgainButton}
              onConfirm={() => void handleWriteAgain()}
            >
              {UI.summaryWriteAgainButton}
            </ConfirmButton>
          ))}
      </div>
    </Card>
  );
}
