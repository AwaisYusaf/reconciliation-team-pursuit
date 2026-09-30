import type { TourKey } from "@/src/db/schema";

/**
 * Route ↔ tour, in the same left-to-right order as the primary nav (`app-nav.tsx`'s
 * `NAV_ITEMS`). Two things read this list: the full first-run walkthrough (`tour.tsx` — it
 * starts only from the Dashboard tour's "Continue the tour" button, never on its own; once
 * running, each later tour's Done, not Skip, navigates to the next entry's `href` so the user
 * is carried from tour to tour rather than having to click into each tab themselves;
 * usability #57) and the header's
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

/**
 * sessionStorage key for a guided walkthrough in progress (tab-scoped). Its value is the
 * `TourKey` of the tab the walkthrough is on right now — not a bare "on" flag.
 *
 * It used to hold `"1"`, which said a walkthrough was running but not where. Anything that
 * stopped the chain without clearing it — reaching a tab whose tour was already seen, or Line
 * Items' "choose a source" panel — left it set, and much later an ordinary visit to Packet or
 * Cover Sheets with "All" selected read it and navigated the user to another tab out of nowhere
 * (review fix). Recording the expected tab means a leftover value can only ever be acted on by
 * that one tab, and every other tab treats it as stale and clears it.
 */
export const TOUR_SEQUENCE_KEY = "tour-sequence-at";

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

/** The tab the walkthrough is on, or `null` when none is running. Storage that is blocked or
 *  unavailable (private browsing, a policy) reads as "none running" — each tour still shows on
 *  its own tab, it just won't carry the user between them. */
function sequencePosition(): string | null {
  try {
    return sessionStorage.getItem(TOUR_SEQUENCE_KEY);
  } catch {
    return null;
  }
}

function setSequencePosition(tour: TourKey): void {
  try {
    sessionStorage.setItem(TOUR_SEQUENCE_KEY, tour);
  } catch {
    // See `sequencePosition`.
  }
}

/** Stop the walkthrough: Skip, Escape, the replay button, the end of the list, or a tab that
 *  can't take its turn. */
export function endTourSequence(): void {
  try {
    sessionStorage.removeItem(TOUR_SEQUENCE_KEY);
  } catch {
    // Nothing to clear if storage isn't available in the first place.
  }
}

/** Begin the walkthrough at its first tab. */
export function startTourSequence(): void {
  setSequencePosition(TOUR_SEQUENCE[0].tour);
}

/**
 * Whether the tour's LAST card offers "Continue the tour", the one control that starts the
 * walkthrough: only the first tab's tour, and never on a replay (usability #57).
 *
 * Done no longer carries anyone off on its own: a first-time user who pressed Done on the
 * Dashboard tour was dragged through a second tour they had not asked for. Continuing is now a
 * choice on that last card.
 *
 * The replay (i) button resets the tour's "shown anything yet" state so it can run again, which
 * made a replayed Dashboard tour look exactly like a brand-new user's first one (review fix).
 * A replay is always a one-off view of one screen, so it never offers the walkthrough.
 */
export function startsWalkthrough(tour: TourKey, { replay }: { replay: boolean }): boolean {
  return tour === TOUR_SEQUENCE[0].tour && !replay;
}

/**
 * Called once when a tab's tour mounts. Keeps a walkthrough that has arrived at this tab in
 * turn, and clears it in every other case:
 * - `willRun` is false (this user has already seen this tab's tour) — the chain can't take its
 *   turn here, and stopping cleanly beats leaving a flag that fires somewhere unrelated later;
 * - the walkthrough is recorded as being on a *different* tab — the user has left it.
 */
export function settleTourSequenceOnMount(tour: TourKey, willRun: boolean): void {
  const at = sequencePosition();
  if (at !== null && (!willRun || at !== tour)) endTourSequence();
}

/**
 * Carry a running walkthrough on from `tour` to the next tab, or end it at the last one.
 *
 * Only acts when the walkthrough is actually on `tour`. Anything else is a leftover from a
 * walkthrough that stopped somewhere else, so it is cleared rather than followed — that is what
 * stops an ordinary later visit to Packet or Cover Sheets with "All" selected (whose
 * `TourSequenceSkip` calls this on every render of the "choose a source" panel) from sending
 * the user to another tab.
 *
 * Shared by the engine (`tour.tsx`, on Done and when a tour has nothing to show) and
 * `TourSequenceSkip` (a tab showing "choose a source first", whose tour can't mount at all).
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
  const at = sequencePosition();
  if (at === null) return;
  if (at !== tour) {
    endTourSequence();
    return;
  }

  const next = nextInSequence(tour);
  if (!next) {
    endTourSequence();
    return;
  }
  setSequencePosition(next.tour);
  router.push(next.href);
  router.refresh();
}
