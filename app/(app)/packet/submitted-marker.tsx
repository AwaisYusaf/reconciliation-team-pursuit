"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

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
}: {
  month: string;
  submittedAt: string | null;
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
        <button
          type="button"
          onClick={() => run(() => clearMonthSubmittedAction(month), "Submission mark removed.")}
          disabled={pending}
          className="text-muted underline disabled:opacity-60"
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => run(() => markMonthSubmittedAction(month), "Month marked as submitted.")}
      disabled={pending}
      className="text-sm text-muted underline disabled:opacity-60"
    >
      Mark as submitted
    </button>
  );
}
