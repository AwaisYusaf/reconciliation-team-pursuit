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
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/src/components/ui/button";
import { ConfirmButton } from "@/src/components/ui/confirm-button";
import { Textarea } from "@/src/components/ui/field";
import { PLUS_FRAME_STYLE } from "@/src/components/ui/plus-badge";
import { Card, DangerPanel, SectionTitle } from "@/src/components/ui/surfaces";
import { toast } from "@/src/components/ui/toast";
import { UI } from "@/src/domain/strings";
import { saveSummaryAction } from "@/src/modules/monthly-summary/actions";
import { copySummary, type ClipboardLike } from "@/src/modules/monthly-summary/copy";

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
          <p className="mt-2.5 text-[15px] text-muted" role="status" aria-live="polite">
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
}) {
  const router = useRouter();
  const [localWriting, setLocalWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const writing = localWriting || serverWriting;

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

  return (
    <Card style={PLUS_FRAME_STYLE} className="p-4 sm:p-5 lg:p-6">
      <SectionTitle className="mb-1">{monthLabel}</SectionTitle>
      <p className="text-[15px] text-muted mb-3">
        {UI.summaryMetaWritten(summary.writtenAtLabel)}
        {editedLabel && UI.summaryMetaEdited(editedLabel.date, editedLabel.name || null)}
      </p>

      {writeError && <DangerPanel className="mb-4">{writeError}</DangerPanel>}

      {stale && (
        <DangerPanel tone="notice" className="mb-4">
          {UI.summaryChangedNotice(monthLabel)}
        </DangerPanel>
      )}

      <DangerPanel tone="notice" className="mb-4">
        {UI.summaryAiReminder}
      </DangerPanel>

      <label htmlFor="monthly-summary-text" className="sr-only">
        {UI.summaryTextareaLabel}
      </label>
      <Textarea
        id="monthly-summary-text"
        value={snapshot.text}
        onChange={(event) => scheduler.edit(event.target.value)}
        readOnly={writing}
        spellCheck
        rows={12}
        className="font-mono lg:min-h-[480px]"
      />

      {/* The server's own reason (signed out, too long), above the Save row — the text stays. */}
      {snapshot.status === "failed" && snapshot.error && snapshot.error !== UI.summaryWriteFailed && (
        <p className="mt-2 text-[15px] text-danger">{snapshot.error}</p>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-4">
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

        <Button variant="secondary" onClick={() => void handleCopy()}>
          {UI.summaryCopyText}
        </Button>

        {canWrite &&
          (writing ? (
            <span role="status" aria-live="polite" className="text-[15px] text-muted">
              {UI.summaryWriting}
            </span>
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
