import type { TourStep } from "@/src/components/ui/tour";

/** Dashboard tab tour (Phase 7, D-94). Copy verbatim from the product spec. Step 2 is dropped
 *  automatically when the org has one funding source, because `[data-tour="funding-source-
 *  selector"]` simply isn't rendered then (`app/r/layout.tsx`) — no conditional needed here. */
export const DASHBOARD_TOUR_STEPS: readonly TourStep[] = [
  {
    target: "month-selector",
    title: "The month",
    body: "This is the month you're working in. Every tab follows it, including expenses, cover sheets and the packet.",
  },
  {
    target: "funding-source-selector",
    title: "The funding source",
    body: "Each funding source has its own budget, expenses and packet. Pick one, or choose All to see them side by side.",
  },
  {
    target: "dashboard-closing-balance",
    title: "Closing Balance",
    body: "This turns red when a line item has less than 10% of its budget left, or is overspent.",
  },
  {
    target: "add-expense-nav",
    title: "Add Expense",
    body: "Add each expense when it happens, with its receipt. Then month-end takes minutes.",
  },
];
