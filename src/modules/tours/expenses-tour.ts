import type { TourStep } from "@/src/components/ui/tour";

/** Expenses tab tour (Phase 7, D-95). All 3 targets are always present once the list has at
 *  least one row; the last two live inside a table row, so on a genuinely empty month there's
 *  nothing to point at and the whole tour is silently skipped (dropped, not blocked on). Step 3
 *  opens the first row's own ⋮ menu (`autoOpen`) rather than just pointing at the closed
 *  trigger, then spotlights the opened panel itself — so Edit/Delete/History are genuinely
 *  visible, not just described (D-95 follow-up: "show the edit and others"). */
export const EXPENSES_TOUR_STEPS: readonly TourStep[] = [
  {
    target: "expenses-filters",
    title: "Filters",
    body: "Search, and filter by line item, documentation or payment source. Filters work together, so changing one keeps the others in place.",
  },
  {
    target: "expenses-reference-viewer",
    title: "Reference number",
    body: "Press the reference number to open every document filed under that expense at once.",
  },
  {
    target: "expenses-row-menu-panel",
    autoOpen: "expenses-row-menu-trigger",
    title: "Edit, delete, history",
    body: "Open the ⋮ menu on a row to edit or delete it. Admins can also see its full history.",
  },
];
