"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { buttonClassName } from "@/src/components/ui/button";
import { reportResult } from "@/src/components/ui/toast";
import { UI } from "@/src/domain/strings";
import { setActiveFundingSourceAction } from "@/src/modules/auth/actions";
import { summaryLinkNeedsSourceSwitch } from "@/src/modules/monthly-summary/dashboard-link";

/**
 * The Dashboard's "Monthly summary ready" link (Phase 11 §7.5). Same pattern as
 * `PickFundingSource`: on "All" or another source, the header must switch to this source before
 * /r/monthly-summary is opened, since that screen follows the header, not this link.
 *
 */
export function MonthlySummaryReadyLink({
  sourceId,
  selectedId,
}: {
  sourceId: string;
  selectedId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!summaryLinkNeedsSourceSwitch(selectedId, sourceId)) {
    return (
      <Link href="/r/monthly-summary" className={buttonClassName("quiet")}>
        {UI.summaryReadyLink}
      </Link>
    );
  }

  return (
    <Link
      href="/r/monthly-summary"
      className={buttonClassName("quiet")}
      aria-disabled={pending || undefined}
      onClick={(event) => {
        event.preventDefault();
        if (pending) return;
        startTransition(async () => {
          const result = await setActiveFundingSourceAction(sourceId);
          if (!reportResult(result)) return;
          // push + refresh, as `expense-form.tsx` does after switching source: the header's
          // source selector lives in the shared layout, which a soft push alone doesn't re-render.
          router.push("/r/monthly-summary");
          router.refresh();
        });
      }}
    >
      {UI.summaryReadyLink}
    </Link>
  );
}
