"use client";

/**
 * The deletion safeguard on the month-end packet: pressing either download button, while
 * something was deleted from this reporting period, opens a confirmation dialog first —
 * listing what was deleted with inline Restore — instead of downloading immediately. The
 * actual download only runs once the dialog's confirm button is pressed. A month with
 * nothing deleted skips the dialog entirely and downloads run exactly as before.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { buttonClassName } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";
import { useDownload } from "@/src/components/ui/download-button";
import { reportResult } from "@/src/components/ui/toast";
import { formatMoney } from "@/src/domain/format";
import { restoreExpenseAction } from "@/src/modules/expenses/actions";

export type DeletedItem = {
  id: string;
  name: string;
  lineItemName: string;
  amountCents: number;
  /** Already formatted for display (`formatDateUS`). */
  deletedAt: string;
};

type PendingKind = "packet" | "summary" | null;

export function PacketDownloadButtons({
  month,
  fundingSourceId,
  blocked,
  deletedItems,
}: {
  month: string;
  fundingSourceId: string;
  blocked: boolean;
  deletedItems: DeletedItem[];
}) {
  const router = useRouter();
  const [restoring, startRestoring] = useTransition();
  const [pendingKind, setPendingKind] = useState<PendingKind>(null);

  const packetDownload = useDownload();
  const summaryDownload = useDownload();

  // `confirmedDeletions=1` is re-checked server-side (both download routes) — the dialog is
  // not the enforcement, just where the user answers it; a direct hit on the URL without this
  // param gets the same 409 refusal the dialog exists to avoid.
  function hrefFor(kind: "packet" | "summary", confirmed: boolean) {
    const base = kind === "packet" ? "/api/downloads/packet" : "/api/downloads/summary";
    return `${base}?month=${month}&source=${fundingSourceId}${confirmed ? "&confirmedDeletions=1" : ""}`;
  }

  function requestDownload(kind: "packet" | "summary") {
    if (deletedItems.length > 0) {
      setPendingKind(kind);
      return;
    }
    void (kind === "packet" ? packetDownload : summaryDownload).download(hrefFor(kind, false));
  }

  function confirmAndDownload() {
    const kind = pendingKind;
    setPendingKind(null);
    if (kind) void (kind === "packet" ? packetDownload : summaryDownload).download(hrefFor(kind, true));
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
      <div className="flex flex-wrap gap-3 mt-6">
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
      </div>

      <Dialog
        open={pendingKind !== null}
        title="Deleted from this month"
        dismissLabel="Cancel"
        onDismiss={() => setPendingKind(null)}
        confirm={{
          label: "Continue to download",
          disabled: restoring,
          onConfirm: confirmAndDownload,
        }}
      >
        <p className="mb-3">
          {deletedItems.length} expense{deletedItems.length === 1 ? " was" : "s were"} deleted
          from this reporting period. Restore anything that shouldn&apos;t have gone, or continue
          if the rest were intentional.
        </p>
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
                disabled={restoring}
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
