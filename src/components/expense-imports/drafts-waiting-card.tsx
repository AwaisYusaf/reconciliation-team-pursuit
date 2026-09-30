import Link from "next/link";

import { buttonClassName } from "@/src/components/ui/button";
import { UI } from "@/src/domain/strings";

/**
 * Invoice drafts still waiting for review (usability #64), on the Dashboard and the Month-End
 * Packet: a card with the count and total, one line on why they matter, and the way to them.
 * Drafts count in no figure until approved (PHASE-14 §6); on a locked month the line says why
 * they can't be approved yet instead of promising it (R10.7).
 */
export function DraftsWaitingCard({
  count,
  amount,
  lockedMonth,
  href,
}: {
  count: number;
  /** The drafts' total, already formatted. */
  amount: string;
  /** The month's label when it is locked, else null. */
  lockedMonth: string | null;
  href: string;
}) {
  return (
    // A soft accent glow in the right corner, behind the button (user review 2026-09-29).
    <div className="bg-surface bg-[radial-gradient(90%_220%_at_100%_50%,color-mix(in_srgb,var(--color-accent)_18%,transparent)_0%,transparent_65%)] border border-line rounded-[3px] px-5 py-4 mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3.5 min-w-0">
        <span
          aria-hidden
          className="shrink-0 grid place-items-center w-10 h-10 rounded-full bg-section text-accent text-base font-bold tabular-nums"
        >
          {count}
        </span>
        <div className="min-w-0">
          <div className="text-base font-bold text-ink">{UI.draftsWaitingTitle(count, amount)}</div>
          <div className="text-[15px] text-sub leading-relaxed">
            {lockedMonth ? UI.draftsWaitingLockedBody(count, lockedMonth) : UI.draftsWaitingBody(count)}
          </div>
        </div>
      </div>
      <Link href={href} className={buttonClassName("secondary", "px-5")}>
        {UI.draftsReviewLink}
      </Link>
    </div>
  );
}
