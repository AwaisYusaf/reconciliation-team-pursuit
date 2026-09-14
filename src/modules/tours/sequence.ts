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

/** The tour immediately after `tour` in the walkthrough order, or `undefined` at the end of
 *  the list (or for a tour that isn't in `TOUR_SEQUENCE` at all, which can't currently happen
 *  since every `TourKey` has exactly one entry — guarded by `sequence.test.ts`). */
export function nextInSequence(tour: TourKey): { tour: TourKey; href: string } | undefined {
  const position = TOUR_SEQUENCE.findIndex((entry) => entry.tour === tour);
  return position >= 0 ? TOUR_SEQUENCE[position + 1] : undefined;
}
