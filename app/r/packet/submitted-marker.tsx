"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { ConfirmButton } from "@/src/components/ui/confirm-button";
import { Dialog } from "@/src/components/ui/dialog";
import { reportResult } from "@/src/components/ui/toast";
import { UI } from "@/src/domain/strings";
import type { ActionResult } from "@/src/lib/action-result";
import { clearMonthSubmittedAction, markMonthSubmittedAction } from "@/src/modules/packet/actions";

/**
 * The submission marker (R10.6, D-21).
 *
 * Deliberately quiet, and deliberately not a lock: it records that a packet went to the City
 * so later edits can warn honestly, but the month stays editable — a correction discovered
 * after submission is exactly when someone needs to make one.
 *
 * Both directions ask first (usability #31, #36): Undo through its `ConfirmButton`, and Mark as
 * submitted through a dialog that says what marking does and, when documents are still
 * missing, lists every record missing them. Marking stays allowed then (R3.9); the dialog only
 * makes sure it is a choice, not a surprise.
 */
export function SubmittedMarker({
  month,
  monthLabel,
  submittedAt,
  fundingSourceId,
  missingDocuments,
  hideUndo = false,
}: {
  month: string;
  /** The month's name, for the mark dialog's title. */
  monthLabel: string;
  submittedAt: string | null;
  fundingSourceId: string;
  /** The R4.4 label of every record still missing documents, listed in the mark dialog. */
  missingDocuments: readonly string[];
  /** The month is locked — Undo is refused server-side anyway, but a locked month keeps
   *  nothing about its submission reversible from here (Appendix A §1, D-96). */
  hideUndo?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function run(action: () => Promise<ActionResult>, message: string) {
    startTransition(async () => {
      if (reportResult(await action(), message)) router.refresh();
    });
  }

  if (submittedAt) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-sub">Submitted {submittedAt}</span>
        {!hideUndo && (
          <ConfirmButton
            variant="quiet"
            disabled={pending}
            title={UI.undoSubmittedTitle(monthLabel)}
            confirmLabel="Undo submission"
            body={UI.undoSubmittedBody}
            onConfirm={() => run(() => clearMonthSubmittedAction(month, fundingSourceId), "Month no longer marked as submitted.")}
          >
            Undo
          </ConfirmButton>
        )}
      </div>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        className="min-h-11 px-4 text-[15px]"
        onClick={() => setConfirming(true)}
        disabled={pending}
      >
        {UI.markSubmittedButton}
      </Button>
      <Dialog
        open={confirming}
        tone="neutral"
        title={UI.markSubmittedTitle(monthLabel)}
        dismissLabel="Cancel"
        onDismiss={() => setConfirming(false)}
        confirm={{
          label: UI.markSubmittedButton,
          disabled: pending,
          onConfirm: () => {
            setConfirming(false);
            run(() => markMonthSubmittedAction(month, fundingSourceId), "Month marked as submitted.");
          },
        }}
      >
        {missingDocuments.length > 0 && (
          <>
            <p className="mb-2 text-caution font-semibold">
              {UI.markSubmittedMissing(missingDocuments.length)}
            </p>
            <ul className="mb-3 max-h-48 overflow-y-auto list-disc pl-5 text-[15px]">
              {missingDocuments.map((label, index) => (
                <li key={index}>{label}</li>
              ))}
            </ul>
            <p className="mb-3">{UI.markSubmittedAnyway}</p>
          </>
        )}
        <p>{UI.markSubmittedBody}</p>
      </Dialog>
    </>
  );
}
