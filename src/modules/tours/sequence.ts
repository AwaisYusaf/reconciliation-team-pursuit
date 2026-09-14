import type { TourKey } from "@/src/db/schema";

/**
 * Route ↔ tour, in the same left-to-right order as the primary nav (`app-nav.tsx`'s
 * `NAV_ITEMS`). Two things read this list: the full first-run walkthrough (`tour.tsx` — on
 * Finish, not Skip, it navigates to the next entry's `href` so a brand-new user is carried
 * from tour to tour rather than having to click into each tab themselves) and the header's
 * "replay this screen's tour" button (`tour-replay-button.tsx`, matches the current pathname
 * against `href` the same way `AppNav` picks its active tab).
 */
export const TOUR_SEQUENCE: readonly { tour: TourKey; href: string }[] = [
  { tour: "dashboard", href: "/r" },
  { tour: "add_expense", href: "/r/expenses/new" },
  { tour: "expenses", href: "/r/expenses" },
  { tour: "cover_sheets", href: "/r/cover-sheets" },
  { tour: "recurring", href: "/r/recurring" },
  { tour: "packet", href: "/r/packet" },
  { tour: "contract_summary", href: "/r/contract-summary" },
  { tour: "line_items", href: "/r/line-items" },
  { tour: "settings", href: "/r/settings" },
];

/** sessionStorage key marking a full guided walkthrough in progress (tab-scoped, cleared on
 *  Skip/Escape or once the sequence reaches its last tour — see `tour.tsx`). */
export const TOUR_SEQUENCE_KEY = "tour-sequence-active";

/**
 * Window event the header's replay (i) button fires, carrying the `TourKey` it just cleared,
 * so the already-mounted `TourGuide` for that tour re-arms itself.
 *
 * `router.refresh()` alone cannot do this (review fix). The button clears the row and
 * refreshes, but if the tour already ran during *this* page visit its `alreadySeen` prop was
 * already `false`, so nothing about it changes — and `begun`/`stepIndex` are client state a
 * refresh preserves, still parked past the end of the step list. Finishing a tour and
 * immediately clicking (i) did nothing at all. The refresh still matters for the server's own
 * "seen" read on the next navigation; this event is what restarts the live component.
 */
export const TOUR_REPLAY_EVENT = "tour:replay";

/** The tour immediately after `tour` in the walkthrough order, or `undefined` at the end of
 *  the list (or for a tour that isn't in `TOUR_SEQUENCE` at all, which can't currently happen
 *  since every `TourKey` has exactly one entry — guarded by `sequence.test.ts`). */
export function nextInSequence(tour: TourKey): { tour: TourKey; href: string } | undefined {
  const position = TOUR_SEQUENCE.findIndex((entry) => entry.tour === tour);
  return position >= 0 ? TOUR_SEQUENCE[position + 1] : undefined;
}

/**
 * Carry a running walkthrough on to the tab after `tour`, or end it quietly at the last one.
 * A no-op unless a walkthrough is actually in progress, so an ordinary single-tour visit
 * never navigates anywhere.
 *
 * Shared by the two things that finish a tour's turn: the engine (`tour.tsx`), on Done and
 * when a tour reaches the end of its steps; and `TourSequenceSkip`, on a screen that can't
 * show its tour at all right now. That second caller is what keeps the chain alive past Cover
 * Sheets, Packet and Contract Summary while "All funding sources" is selected — each shows a
 * "choose a source first" panel instead of its real content, so its tour has nothing to point
 * at, and the walkthrough used to simply stop there and never reach the tabs after it.
 *
 * `refresh()` after `push()` isn't redundant: Next's client Router Cache can serve a prefetched
 * payload for the next route computed before the current tour's "seen" write landed, which
 * would hand the next tour a stale `alreadySeen`.
 *
 * `router` is typed structurally rather than as Next's `AppRouterInstance` so this stays a
 * plain function — testable with a stub, no React and no deep framework import.
 */
export function continueTourSequence(
  tour: TourKey,
  router: { push: (href: string) => void; refresh: () => void },
): void {
  let active = false;
  try {
    active = sessionStorage.getItem(TOUR_SEQUENCE_KEY) === "1";
  } catch {
    // Storage blocked or unavailable — treated as "no walkthrough running", same as a fresh tab.
  }
  if (!active) return;

  const next = nextInSequence(tour);
  if (!next) {
    try {
      sessionStorage.removeItem(TOUR_SEQUENCE_KEY);
    } catch {
      // Nothing to clean up if storage isn't available in the first place.
    }
    return;
  }
  router.push(next.href);
  router.refresh();
}
