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
 *
 * Clears `TOUR_SEQUENCE_KEY` before refreshing: the guided walkthrough's own "carry me to the
 * next tab" flag (`tour.tsx`) lives in `sessionStorage` for the whole tab, not just the one
 * navigation that set it — if it were still `"1"` from an earlier full walkthrough, replaying a
 * single tour here and clicking Done would silently chain into every other tab's tour too. This
 * button is always a one-off, standalone view of one screen's tour, never a resumed sequence.
 */
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { matches } from "@/src/components/app-shell/app-nav";
import { replayTourAction } from "@/src/modules/tours/actions";
import { TOUR_REPLAY_EVENT, TOUR_SEQUENCE, TOUR_SEQUENCE_KEY } from "@/src/modules/tours/sequence";

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
          try {
            sessionStorage.removeItem(TOUR_SEQUENCE_KEY);
          } catch {
            // Nothing to clean up if storage isn't available in the first place.
          }
          await replayTourAction(current.tour);
          // Re-arms the `TourGuide` already mounted on this page. `refresh()` alone only
          // freshens the server's own "seen" read for the *next* navigation — it cannot
          // restart a tour that already ran during this page visit, since its `alreadySeen`
          // prop is unchanged either way (review fix — see `TOUR_REPLAY_EVENT`).
          window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT, { detail: current.tour }));
          router.refresh();
        })
      }
      className="shrink-0 h-7 w-7 text-[12px] leading-none flex items-center justify-center rounded-full border border-line text-accent font-serif font-bold italic hover:bg-section disabled:opacity-60"
    >
      i
    </button>
  );
}
