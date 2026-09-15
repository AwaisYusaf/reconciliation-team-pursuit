import type { TourStep } from "@/src/components/ui/tour";

/** Cover Sheets tab tour (Phase 7, D-95). Step 2 ("What's blocking a download") only exists
 *  when at least one line item currently has a blocking expense — dropped otherwise, the same
 *  pattern the Packet tour already uses for its own blocking-alert step. */
export const COVER_SHEETS_TOUR_STEPS: readonly TourStep[] = [
  {
    target: "cover-sheet-line-item-picker",
    title: "Choose a line item",
    body: "See one line item's cover sheet, or All line items to view every one stacked together.",
  },
  {
    target: "cover-sheet-blocked",
    title: "What's blocking a download",
    body: "Downloads for a line item are disabled while any of its expenses are missing documentation. Open expense takes you straight to the fix.",
  },
  {
    target: "cover-sheet-preview",
    title: "The preview",
    body: "This is exactly what downloads — the same figures, in the same order, as the Word and PDF versions.",
  },
];
