"use client";

/**
 * The deletion safeguard on the month-end packet: pressing either download button, while
 * something was deleted from this reporting period, opens a confirmation dialog first —
 * listing what was deleted with inline Restore — instead of downloading immediately. The
 * actual download only runs once the dialog's confirm button is pressed. A month with
 * nothing deleted skips the dialog entirely and downloads run exactly as before.
 *
 * Sharing goes through the same safeguard (PHASE-12 §7, Appendix A §1, §4): Share link and
 * Update shared file wait for the same "Continue to download" before they run, and the red
 * documentation panel disables them as it does the downloads.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { buttonClassName } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";
import { useDownload } from "@/src/components/ui/download-button";
import { reportResult } from "@/src/components/ui/toast";
import { monthLabel } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { UI } from "@/src/domain/strings";
import { restoreExpenseAction } from "@/src/modules/expenses/actions";
import type { SharedLinkView } from "@/src/modules/sharing/queries";

import { ShareLinkDialog } from "./share-link-dialog";
import { postShareRoute, SHARE_BUTTON_ID, SharedLinksBox } from "./shared-links";

export type DeletedItem = {
  id: string;
  name: string;
  lineItemName: string;
  amountCents: number;
  /** Already formatted for display (`formatDateUS`). */
  deletedAt: string;
};

/** What runs once the deleted-items dialog is answered — a download, the share dialog, or an update. */
type Continuation = (confirmedDeletions: boolean) => void;

export function PacketDownloadButtons({
  month,
  fundingSourceId,
  blocked,
  deletedItems,
  locked,
  sharedLinks,
  orgCancelled,
}: {
  month: string;
  fundingSourceId: string;
  blocked: boolean;
  deletedItems: DeletedItem[];
  /** Restoring an expense is one of the writes a locked month refuses (Appendix A §2, D-96). */
  locked: boolean;
  sharedLinks: SharedLinkView[];
  orgCancelled: boolean;
}) {
  const router = useRouter();
  const label = monthLabel(month);
  const [restoring, startRestoring] = useTransition();
  const [pending, setPending] = useState<Continuation | null>(null);
  // Mounted only while open, so every opening starts from a fresh form.
  const [shareDialog, setShareDialog] = useState<{ confirmedDeletions: boolean } | null>(null);
  // One entry per row whose file is building, so two Updates never share one busy state.
  const [updatingIds, setUpdatingIds] = useState<ReadonlySet<string>>(new Set());
  // Sharing and updating are refused for a cancelled plan (C4), as for a blocked month.
  const shareBlocked = blocked || orgCancelled;

  const packetDownload = useDownload();
  const summaryDownload = useDownload();

  // `confirmedDeletions=1` is re-checked server-side (both download routes) — the dialog is
  // not the enforcement, just where the user answers it; a direct hit on the URL without this
  // param gets the same 409 refusal the dialog exists to avoid.
  function hrefFor(kind: "packet" | "summary", confirmed: boolean) {
    const base = kind === "packet" ? "/api/downloads/packet" : "/api/downloads/summary";
    return `${base}?month=${month}&source=${fundingSourceId}${confirmed ? "&confirmedDeletions=1" : ""}`;
  }

  /** Run now when nothing was deleted this month; otherwise ask first, every time. */
  function gated(run: Continuation) {
    if (deletedItems.length > 0) {
      // A function in state must be wrapped, or React calls it as an updater.
      setPending(() => run);
      return;
    }
    run(false);
  }

  function continueAfterConfirm() {
    const run = pending;
    setPending(null);
    run?.(true);
  }

  function requestDownload(kind: "packet" | "summary") {
    gated((confirmed) => void (kind === "packet" ? packetDownload : summaryDownload).download(hrefFor(kind, confirmed)));
  }

  async function updateSharedFile(link: SharedLinkView, confirmedDeletions: boolean) {
    setUpdatingIds((ids) => new Set(ids).add(link.id));
    const result = await postShareRoute<undefined>("/api/shared-links/update", {
      shareId: link.id,
      confirmedDeletions,
    });
    setUpdatingIds((ids) => {
      const next = new Set(ids);
      next.delete(link.id);
      return next;
    });
    reportResult(result, UI.shareUpdated);
    router.refresh();
  }

  function restore(item: DeletedItem) {
    startRestoring(async () => {
      if (reportResult(await restoreExpenseAction(item.id), `${item.name} restored`)) {
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-3 mt-6" data-tour="packet-downloads">
        <button
          type="button"
          className={buttonClassName("primary")}
          disabled={blocked || packetDownload.busy}
          onClick={() => requestDownload("packet")}
        >
          {packetDownload.busy ? "Assembling…" : "Download Packet (PDF)"}
        </button>
        <button
          type="button"
          className={buttonClassName("secondary")}
          disabled={blocked || summaryDownload.busy}
          onClick={() => requestDownload("summary")}
        >
          {summaryDownload.busy ? "Preparing…" : "Download Summary (Excel)"}
        </button>
        <button
          id={SHARE_BUTTON_ID}
          type="button"
          className={buttonClassName("secondary")}
          disabled={shareBlocked}
          onClick={() => gated((confirmedDeletions) => setShareDialog({ confirmedDeletions }))}
        >
          {UI.shareButton}
        </button>
      </div>
      {/* Why Share link is off when the plan is cancelled, even before anything was shared. */}
      {orgCancelled && sharedLinks.length === 0 && (
        <p className="text-sm text-danger mt-2">{UI.shareCancelledRefused}</p>
      )}

      <SharedLinksBox
        links={sharedLinks}
        monthLabel={label}
        updateBlocked={shareBlocked}
        orgCancelled={orgCancelled}
        updatingIds={updatingIds}
        onUpdate={(link) => gated((confirmed) => void updateSharedFile(link, confirmed))}
      />

      {shareDialog && (
        <ShareLinkDialog
          onClose={() => setShareDialog(null)}
          month={month}
          monthLabel={label}
          fundingSourceId={fundingSourceId}
          confirmedDeletions={shareDialog.confirmedDeletions}
          links={sharedLinks}
          updateBlocked={shareBlocked}
          updatingIds={updatingIds}
          onUpdate={(link, confirmed) => void updateSharedFile(link, confirmed)}
        />
      )}

      <Dialog
        open={pending !== null}
        title="Deleted from this month"
        dismissLabel="Cancel"
        onDismiss={() => setPending(null)}
        confirm={{
          label: "Continue to download",
          disabled: restoring,
          onConfirm: continueAfterConfirm,
        }}
      >
        <p className="mb-3">
          {deletedItems.length} expense{deletedItems.length === 1 ? " was" : "s were"} deleted
          from this reporting period. Restore anything that shouldn&apos;t have gone, or continue
          if the rest were intentional.
        </p>
        {locked && <p className="mb-3 font-semibold">{UI.monthLocked(label)}</p>}
        <ul className="flex flex-col divide-y divide-danger/25 -mx-1">
          {deletedItems.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-1 py-2.5">
              <div className="min-w-0">
                <div className="font-bold truncate">{item.name}</div>
                <div className="text-sm opacity-80 truncate">
                  {item.lineItemName} — {formatMoney(item.amountCents)} — deleted {item.deletedAt}
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 underline font-medium disabled:opacity-50"
                disabled={restoring || locked}
                onClick={() => restore(item)}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
