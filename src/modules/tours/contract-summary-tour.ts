import type { TourStep } from "@/src/components/ui/tour";

/** Contract Summary tab tour (Phase 7, D-95). Kept to 2 steps — this screen is read-only and
 *  largely self-labeled; the two things actually worth calling out are what the table mirrors
 *  and that the reconciliation card below it is a separate figure from the totals above. */
export const CONTRACT_SUMMARY_TOUR_STEPS: readonly TourStep[] = [
  {
    target: "contract-summary-table",
    title: "Contract Summary",
    body: "This mirrors the Excel workbook the funder receives. Balance to Finish turns red when a line item is overspent.",
  },
  {
    target: "contract-summary-reconciliation",
    title: "Advance reconciliation",
    body: "A separate figure from the totals above — this tracks advance payments received against what's been reconciled so far.",
  },
];
