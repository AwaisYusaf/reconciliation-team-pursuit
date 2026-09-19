import type { TourStep } from "@/src/components/ui/tour";

/** Line Items tab tour (Phase 7, D-95). Step 3 clicks the first row's "Manage" button itself
 *  (`autoOpen`, D-92's combined edit/performances panel) before spotlighting the Performances
 *  table inside it, rather than only describing a modal the user hasn't opened yet. */
export const LINE_ITEMS_TOUR_STEPS: readonly TourStep[] = [
  {
    target: "line-items-reorder",
    title: "Reordering",
    body: "This order matters. Line items appear in it on cover sheets, the packet and the dashboard.",
  },
  {
    target: "line-items-manage",
    title: "Manage",
    body: "Manage opens the line item's own fields and its performances (milestone billing amounts) in one place.",
  },
  {
    target: "line-items-performances",
    autoOpen: "line-items-manage",
    title: "Performances",
    body: "A saved performance's amount can't always be edited. If it needs to change, delete the performance and add it again.",
  },
];
