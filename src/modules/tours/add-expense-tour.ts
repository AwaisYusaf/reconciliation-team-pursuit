import type { TourStep } from "@/src/components/ui/tour";

/** Add Expense tab tour (Phase 7, D-94) — the most complex screen. Copy verbatim from the
 *  product spec. Mounted on the *new*-expense route only; never on edit. */
export const ADD_EXPENSE_TOUR_STEPS: readonly TourStep[] = [
  {
    target: "add-expense-name",
    title: "Name",
    body: "Start typing. Vendors you've used before fill in the rest of the details for you.",
  },
  {
    target: "add-expense-description",
    title: "Description / role",
    body: "This exact text prints on the cover sheet the City reads, so write it the way it should appear.",
  },
  {
    target: "add-expense-amounts",
    title: "Subtotal, Tax and Fees",
    body: "Enter the amounts from the receipt. If there's tax or fees, you'll be asked whether the funder pays for them.",
  },
  {
    target: "add-expense-reimbursable",
    title: "Reimbursable amount",
    body: "This is the amount being claimed. Anything not reimbursed is noted on the cover sheet.",
  },
  {
    target: "add-expense-proof",
    title: "Proof of payment",
    body: "Always required. Add a bank transaction or payment screenshot. Without it, the month's packet can't be downloaded.",
  },
  {
    target: "add-expense-receipt",
    title: "Receipt",
    body: "Add the receipt, invoice or timesheet. If there isn't one, tick No receipt available and give a reason. The reason prints on the cover sheet.",
  },
];
