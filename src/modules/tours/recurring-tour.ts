import type { TourStep } from "@/src/components/ui/tour";

/** Recurring tab tour (Phase 7, D-94). Copy verbatim from the product spec.
 *
 *  Step 1 tries the per-row "Add to {month}" button first, and falls back to the empty-state
 *  "+ Add recurring item" button when the list is empty — the spec's own wording ("If the list
 *  is empty, use the 'Add recurring item' button"), expressed as the engine's ordinary
 *  first-match-wins target list (§3.6), no special casing.
 *
 *  Step 2 targets a row already added to the month; if nothing has been added yet, that target
 *  simply isn't on the page and the step is dropped the same way. */
export const RECURRING_TOUR_STEPS: readonly TourStep[] = [
  {
    target: ["recurring-add-to-month", "recurring-add-item"],
    title: "Adding to the month",
    body: "Nothing is added automatically. Press Add for each bill or salary you want in this month.",
  },
  {
    target: "recurring-added-item",
    title: "Already added",
    body: "Added items still need their proof of payment. Open each one from the Expenses tab to attach it.",
  },
];
