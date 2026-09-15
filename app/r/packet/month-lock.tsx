"use client";

/**
 * Locking a reconciled month, on the Month-End Packet tab (Appendix A §1, §3, D-96).
 *
 * `MonthLockControls` sits in the page header beside the Submitted marker: the Reconciled
 * line and its Lock/Unlock dialogs. `LockHistory` is the month's event list beneath the
 * header. Locking itself is one upload request (plan §3.6) — the same shape the month
 * documents form already posts to `/api/files/upload` — never a Server Action, so a 25 MB
 * signed PDF isn't limited by that body cap.
 */
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button, buttonClassName } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";
import { Label, Textarea } from "@/src/components/ui/field";
import { Card, SubsectionTitle } from "@/src/components/ui/surfaces";
import { reportResult } from "@/src/components/ui/toast";
import { formatDateUS, todayIso } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { cn } from "@/src/lib/cn";
import { unlockMonthAction } from "@/src/modules/packet/actions";
import type { LockEventRow } from "@/src/modules/packet/queries";
import { inlineSrc } from "@/src/services/storage/preview";

import { SubmittedMarker } from "./submitted-marker";

export type LockedEvent = { id: string; date: string; name: string };

export function MonthLockControls({
  month,
  monthLabel,
  fundingSourceId,
  submittedAt,
  locked,
  lockedEvent,
  blocked,
}: {
  month: string;
  monthLabel: string;
  fundingSourceId: string;
  submittedAt: string | null;
  locked: boolean;
  /** The month's current signed copy — always present when `locked` is true. */
  lockedEvent: LockedEvent | null;
  /** The red blocking panel is showing — Lock month stays disabled with its reason
   *  (Appendix A §1). */
  blocked: boolean;
}) {
  const router = useRouter();
  const [locking, setLocking] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function closeLock() {
    // Review fix: once the signed copy is sending, the server may lock the month whatever the
    // browser does next — closing here told the user nothing happened, then it locked anyway.
    if (uploading) return;
    setLocking(false);
    setFile(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function lock() {
    if (!file) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.set("target", "signed-packet");
    form.set("month", month);
    form.set("fundingSourceId", fundingSourceId);
    form.set("file", file);
    try {
      const response = await fetch("/api/files/upload", { method: "POST", body: form });
      const result = (await response.json()) as { ok: boolean; error?: string };
      setUploading(false);
      if (!result.ok) {
        setError(result.error ?? UI.uploadFailed);
        return;
      }
      // Not `closeLock()`: `uploading` in its closure is still the stale `true`.
      setLocking(false);
      setFile(null);
      router.refresh();
    } catch {
      setUploading(false);
      setError(UI.uploadFailed);
    }
  }

  function unlock() {
    setError(null);
    startTransition(async () => {
      const result = await unlockMonthAction(month, fundingSourceId, reason);
      // A refusal is shown inside the open dialog only. `reportResult` would also raise an error
      // toast behind it, so the same message appeared twice.
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reportResult(result, "Month unlocked.");
      setUnlocking(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {locked && lockedEvent && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 justify-end">
          <span className="text-sm">
            <span className="font-bold text-ink">{UI.reconciledLabel}</span>
            <span className="text-muted"> · {UI.lockedOnBy(lockedEvent.date, lockedEvent.name)}</span>
          </span>
          {/* A link styled as a button, not a <button>: it opens the stored PDF in a new tab. */}
          <a
            href={inlineSrc(lockedEvent.id)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClassName("secondary", "min-h-11 px-4 text-[15px]")}
          >
            {UI.viewSignedPacket}
          </a>
          <Button
            variant="secondary"
            className="min-h-11 px-4 text-[15px]"
            disabled={pending}
            onClick={() => setUnlocking(true)}
          >
            {UI.unlockButtonLabel}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SubmittedMarker
          month={month}
          submittedAt={submittedAt}
          fundingSourceId={fundingSourceId}
          hideUndo={locked}
        />
        {!locked && (
          <Button
            variant="secondary"
            className="min-h-11 px-4 text-[15px]"
            disabled={blocked}
            aria-describedby={blocked ? "lock-needs-documents" : undefined}
            onClick={() => setLocking(true)}
          >
            {UI.lockButtonLabel}
          </Button>
        )}
      </div>
      {!locked && blocked && (
        <span id="lock-needs-documents" className="text-sm text-danger">
          {UI.lockNeedsDocuments}
        </span>
      )}

      <Dialog
        open={locking}
        tone="neutral"
        title={UI.lockDialogTitle(monthLabel)}
        dismissLabel="Cancel"
        dismissDisabled={uploading}
        onDismiss={closeLock}
        confirm={{ label: UI.lockButtonLabel, disabled: !file || uploading, onConfirm: lock }}
      >
        <p className="mb-3">{UI.lockDialogText}</p>
        {/* The native picker is hidden behind a real button, the same way the month documents
            upload does it, so the dialog doesn't show the browser's own unstyled file control. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            // A refusal was about the file previously chosen, not this one.
            setError(null);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            className="min-h-11 px-[18px] text-[15px]"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose file
          </Button>
          <span className="text-[15px] truncate max-w-[220px]" aria-live="polite">
            {file?.name ?? "No file chosen"}
          </span>
        </div>
        {uploading && (
          <p className="mt-2 text-sm" role="status">
            Uploading…
          </p>
        )}
        {error && (
          <p className="mt-2 text-sm font-semibold text-danger" role="alert">
            {error}
          </p>
        )}
      </Dialog>

      <Dialog
        open={unlocking}
        tone="neutral"
        title={UI.unlockDialogTitle(monthLabel)}
        dismissLabel="Cancel"
        dismissDisabled={pending}
        onDismiss={() => {
          setUnlocking(false);
          setError(null);
        }}
        confirm={{ label: UI.unlockButtonLabel, disabled: pending, onConfirm: unlock }}
      >
        <p className="mb-3">{UI.unlockDialogText}</p>
        <Label htmlFor="unlock-reason">
          Reason <span className="font-normal">(optional)</span>
        </Label>
        <Textarea
          id="unlock-reason"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={UI.unlockReasonPlaceholder}
        />
        {error && (
          <p className="mt-2 text-sm font-semibold text-danger" role="alert">
            {error}
          </p>
        )}
      </Dialog>
    </div>
  );
}

/** The month's lock/unlock history, oldest first (Appendix A §1, §3). */
export function LockHistory({
  events,
  className,
}: {
  events: LockEventRow[];
  className?: string;
}) {
  if (events.length === 0) return null;

  return (
    <Card className={cn("mb-7 px-4 sm:px-5 py-3", className)}>
      <SubsectionTitle className="mb-1">{UI.lockHistoryTitle}</SubsectionTitle>
      <ul className="divide-y divide-line">
        {events.map((event, index) => {
          const date = formatDateUS(todayIso(event.createdAt));
          // The next lock after this one, if any — this copy was replaced by it (plan §3.1).
          const nextLock = event.isLock
            ? events.slice(index + 1).find((later) => later.isLock)
            : undefined;
          return (
            <li
              key={event.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[15px]"
            >
              {/* Filled: the signed copy in force. Hollow: a copy since replaced. Grey: an unlock. */}
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0 rounded-full border-2",
                  !event.isLock
                    ? "border-line bg-line"
                    : nextLock
                      ? "border-accent bg-transparent"
                      : "border-accent bg-accent",
                )}
              />
              <span className={cn("min-w-0 flex-1", event.isLock && !nextLock ? "text-ink" : "text-sub")}>
                {event.isLock
                  ? UI.lockedBy(date, event.userDisplay)
                  : UI.unlockEventLine(date, event.userDisplay, event.reason)}
              </span>
              {nextLock && (
                <span className="text-[13px] text-sub bg-section rounded-full px-2.5 py-0.5">
                  {UI.replacedOn(formatDateUS(todayIso(nextLock.createdAt)))}
                </span>
              )}
              {event.isLock && (
                <a
                  href={inlineSrc(event.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent font-semibold underline underline-offset-2 hover:no-underline"
                >
                  {UI.viewSignedPacket}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
