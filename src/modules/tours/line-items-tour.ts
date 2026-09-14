import type { TourStep } from "@/src/components/ui/tour";

/** Line Items tab tour (Phase 7, D-95). Step 3 clicks the first row's "Manage" button itself
 *  (`autoOpen`, D-92's combined edit/performances panel) before spotlighting the Performances
 *  table inside it, rather than only describing a modal the user hasn't opened yet. */
export const LINE_ITEMS_TOUR_STEPS: readonly TourStep[] = [
  {
    target: "line-items-reorder",
    title: "Reordering",
    body: "This order isn't just cosmetic — it's the order line items print in on cover sheets, the packet, and the dashboard.",
  },
  {
    target: "line-items-manage",
    title: "Manage",
    body: "Manage opens both the line item's own fields and its performances — milestone billing amounts — in one place.",
  },
  {
    target: "line-items-performances",
    autoOpen: "line-items-manage",
    title: "Performances",
    body: "Once a performance is saved, its amount can't always be edited in place — delete and re-add it if the amount needs to change.",
  },
];
