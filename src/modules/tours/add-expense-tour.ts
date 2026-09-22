import type { TourStep } from "@/src/components/ui/tour";
import { UI } from "@/src/domain/strings";

/** Add Expense tab tour (Phase 7, D-94) — the most complex screen. Copy verbatim from the
 *  product spec. Mounted on the *new*-expense route only; never on edit.
 *
 * A function rather than a constant since Phase 10 (D-105): with reading available the form
 * puts Proof of payment and Receipt above the amounts, so the steps follow that order and the
 * three document/amount steps explain what AI does. Without it, the original order and text. */
export function addExpenseTourSteps(readAmounts: boolean): readonly TourStep[] {
  const name: TourStep = {
    target: "add-expense-name",
    title: "Name",
    body: "Start typing. Vendors you've used before fill in the rest of the details for you.",
  };
  const description: TourStep = {
    target: "add-expense-description",
    title: "Description / role",
    body: "This exact text prints on the cover sheet the City reads, so write it the way it should appear.",
  };
  const amounts: TourStep = {
    target: "add-expense-amounts",
    title: "Subtotal, Tax and Fees",
    body: readAmounts ? UI.tourAmountsBodyWithReading : UI.tourAmountsBody,
  };
  const reimbursable: TourStep = {
    target: "add-expense-reimbursable",
    title: "Reimbursable amount",
    body: "This is the amount being claimed. Anything not reimbursed is noted on the cover sheet.",
  };
  const proof: TourStep = {
    target: "add-expense-proof",
    title: "Proof of payment",
    body: readAmounts ? UI.tourProofBodyWithReading : UI.tourProofBody,
  };
  const receipt: TourStep = {
    target: "add-expense-receipt",
    title: "Receipt",
    body: readAmounts ? UI.tourReceiptBodyWithReading : UI.tourReceiptBody,
  };

  /**
   * Phase 14. Last, not first: this screen's job is still one expense typed by hand, and the
   * tour should teach that before offering the shortcut past it.
   *
   * Only offered alongside reading, because the button it points at only exists then — and the
   * engine drops a step whose target is not on the page, so an organisation without the Plus
   * plan simply gets the tour it had before rather than a step about a button it cannot see.
   */
  const fromInvoice: TourStep = {
    target: "add-expense-from-invoice",
    title: "One invoice, many charges",
    body: "If a bill covers several charges, upload it once here. Each line becomes its own charge for you to check, and anything you are not ready to finish waits as a draft on the Expenses tab.",
  };

  return readAmounts
    ? [name, description, proof, receipt, amounts, reimbursable, fromInvoice]
    : [name, description, amounts, reimbursable, proof, receipt];
}
