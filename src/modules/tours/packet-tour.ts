import type { TourStep } from "@/src/components/ui/tour";

/** Month-End Packet tab tour (Phase 7, D-94). Copy verbatim from the product spec.
 *
 *  Step 2 targets the red "cannot be downloaded yet" alert and is simply absent — dropped, not
 *  blocked on (§3.6) — when nothing is blocking the download.
 *
 *  "If 'All funding sources' is selected, ask the user to choose one first. Don't start the
 *  tour until a source is chosen" is handled at the page level, not here: `app/r/packet/page.tsx`
 *  already resolves synchronously, server-side, whether a single source is selected, and this
 *  tour is only ever mounted on the branch that renders the real packet content — the
 *  `PickFundingSource` branch never imports it. */
export const PACKET_TOUR_STEPS: readonly TourStep[] = [
  {
    target: "packet-doc-complete",
    title: "Documentation Complete",
    body: "Every line item needs a Yes here before you can download.",
  },
  {
    target: "packet-blocking-alert",
    title: "What's missing",
    body: "These expenses are missing a document. Open expense takes you straight to the fix.",
  },
  {
    target: "packet-month-documents",
    title: "Month documents",
    body: "Bank statements, timesheets and the fiduciary invoice go here. They're optional and never block a download.",
  },
  {
    target: "packet-downloads",
    title: "Download",
    body: "Download the packet PDF for signing and the Excel summary.",
  },
  {
    target: "packet-submit",
    title: "Mark as submitted",
    body: "Mark the month as submitted once it's sent. When the signed copy comes back, lock the month so nothing changes by accident.",
  },
];
