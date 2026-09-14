"use client";

/**
 * The header's "replay this screen's tour" control (Phase 7, D-94 follow-up) — a small (i)
 * button next to Log out so a user can see a tab's walkthrough again right there, instead of
 * going to Settings and resetting every tour at once.
 *
 * Resolves the current tab's tour the same way `AppNav` resolves its own active tab (longest
 * matching `href` wins) rather than duplicating that logic — see `matches()` in `app-nav.tsx`.
 * One known simplification: a route that isn't itself a step in `TOUR_SEQUENCE` (an expense's
 * edit page, say) still matches its nearest ancestor entry — clicking here on that page clears
 * that tour's "seen" row even though nothing on the current page can show it, so it simply
 * re-arms for the next real visit to that tab rather than replaying immediately. Not special-
 * cased further: it's the same ambiguity `AppNav` already accepts when highlighting a tab as
 * active from a sub-route.
 */
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { matches } from "@/src/components/app-shell/app-nav";
import { replayTourAction } from "@/src/modules/tours/actions";
import { TOUR_SEQUENCE } from "@/src/modules/tours/sequence";

export function TourReplayButton() {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const current = TOUR_SEQUENCE.filter((entry) => matches(pathname, entry.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];

  // No tour belongs to this route at all (e.g. the trash or history sub-pages) — nothing to
  // replay, so the control doesn't render rather than sitting there disabled.
  if (!current) return null;

  return (
    <button
      type="button"
      title="Show this screen's walkthrough again"
      aria-label="Show this screen's walkthrough again"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await replayTourAction(current.tour);
          router.refresh();
        })
      }
      className="shrink-0 min-h-11 min-w-11 sm:min-h-12 sm:min-w-12 flex items-center justify-center rounded-full border border-line text-accent font-serif font-bold italic hover:bg-section disabled:opacity-60"
    >
      i
    </button>
  );
}
