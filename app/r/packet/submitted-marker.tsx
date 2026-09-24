"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { ConfirmButton } from "@/src/components/ui/confirm-button";
import { reportResult } from "@/src/components/ui/toast";
import type { ActionResult } from "@/src/lib/action-result";
import { clearMonthSubmittedAction, markMonthSubmittedAction } from "@/src/modules/packet/actions";

/**
 * The submission marker (R10.6, D-21).
 *
 * Deliberately quiet, and deliberately not a lock: it records that a packet went to the City
 * so later edits can warn honestly, but the month stays editable — a correction discovered
 * after submission is exactly when someone needs to make one.
 */
export function SubmittedMarker({
  month,
  submittedAt,
  fundingSourceId,
  hideUndo = false,
}: {
  month: string;
  submittedAt: string | null;
  fundingSourceId: string;
  /** The month is locked — Undo is refused server-side anyway, but a locked month keeps
   *  nothing about its submission reversible from here (Appendix A §1, D-96). */
  hideUndo?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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
            title="Undo the submission mark?"
            confirmLabel="Undo submission"
            body={
              <>
                This also discards the figures saved when the month was marked as submitted, which
                later changes are compared against. If you mark it as submitted again, the figures
                are saved as they stand at that time, not as they stood before.
              </>
            }
            onConfirm={() => run(() => clearMonthSubmittedAction(month, fundingSourceId), "Month no longer marked as submitted.")}
          >
            Undo
          </ConfirmButton>
        )}
      </div>
    );
  }

  return (
    <Button
      variant="secondary"
      className="min-h-11 px-4 text-[15px]"
      onClick={() => run(() => markMonthSubmittedAction(month, fundingSourceId), "Month marked as submitted.")}
      disabled={pending}
    >
      Mark as submitted
    </Button>
  );
}
