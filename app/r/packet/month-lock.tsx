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

import { Dialog } from "@/src/components/ui/dialog";
import { Label, Textarea } from "@/src/components/ui/field";
import { reportResult } from "@/src/components/ui/toast";
import { formatDateUS, todayIso } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { cn } from "@/src/lib/cn";
import { unlockMonthAction } from "@/src/modules/packet/actions";
import type { LockEventRow } from "@/src/modules/packet/queries";

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
      closeLock();
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 justify-end text-sm">
          <span className="font-bold text-ink">{UI.reconciledLabel}</span>
          <span className="text-muted">·</span>
          <span className="text-muted">{UI.lockedOnBy(lockedEvent.date, lockedEvent.name)}</span>
          <span className="text-muted">·</span>
          <a
            href={`/api/files/${lockedEvent.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            {UI.viewSignedPacket}
          </a>
          <span className="text-muted">·</span>
          <button
            type="button"
            className="text-accent underline disabled:opacity-60"
            disabled={pending}
            onClick={() => setUnlocking(true)}
          >
            {UI.unlockButtonLabel}
          </button>
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
          <button
            type="button"
            className="text-sm text-muted underline disabled:opacity-60"
            disabled={blocked}
            onClick={() => setLocking(true)}
          >
            {UI.lockButtonLabel}
          </button>
        )}
      </div>
      {!locked && blocked && <span className="text-sm text-danger">{UI.lockNeedsDocuments}</span>}

      <Dialog
        open={locking}
        title={UI.lockDialogTitle(monthLabel)}
        dismissLabel="Cancel"
        onDismiss={closeLock}
        confirm={{ label: UI.lockButtonLabel, disabled: !file || uploading, onConfirm: lock }}
      >
        <p className="mb-3">{UI.lockDialogText}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        {uploading && <p className="mt-2 text-sm">Uploading…</p>}
        {error && <p className="mt-2 text-sm font-semibold">{error}</p>}
      </Dialog>

      <Dialog
        open={unlocking}
        title={UI.unlockDialogTitle(monthLabel)}
        dismissLabel="Cancel"
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
        {error && <p className="mt-2 text-sm font-semibold">{error}</p>}
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
    <ul className={cn("flex flex-col gap-1.5 text-sm text-muted mb-7", className)}>
      {events.map((event, index) => {
        const date = formatDateUS(todayIso(event.createdAt));
        if (event.isLock) {
          // The next lock after this one, if any — this copy was replaced by it (plan §3.1).
          const nextLock = events.slice(index + 1).find((later) => later.isLock);
          return (
            <li key={event.id} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span>{UI.lockedBy(date, event.userDisplay)}</span>
              <span>·</span>
              <a
                href={`/api/files/${event.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                {UI.viewSignedPacket}
              </a>
              {nextLock && (
                <span>· {UI.replacedOn(formatDateUS(todayIso(nextLock.createdAt)))}</span>
              )}
            </li>
          );
        }
        return <li key={event.id}>{UI.unlockEventLine(date, event.userDisplay, event.reason)}</li>;
      })}
    </ul>
  );
}
