"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

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
}: {
  month: string;
  submittedAt: string | null;
  fundingSourceId: string;
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
        <span className="text-muted">Submitted {submittedAt}</span>
        <ConfirmButton
          variant="quiet"
          disabled={pending}
          title="Undo the submission mark?"
          confirmLabel="Undo submission"
          body={
            <>
              This also discards the figures captured when the month was marked submitted, which
              are what later changes are compared against. Marking it submitted again captures
              the month as it stands then, not as it stood before.
            </>
          }
          onConfirm={() => run(() => clearMonthSubmittedAction(month, fundingSourceId), "Submission mark removed.")}
        >
          Undo
        </ConfirmButton>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => run(() => markMonthSubmittedAction(month, fundingSourceId), "Month marked as submitted.")}
      disabled={pending}
      className="text-sm text-muted underline disabled:opacity-60"
    >
      Mark as submitted
    </button>
  );
}
