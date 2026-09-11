/**
 * How a remembered vendor is applied to the expense form (R8.1).
 *
 * Pure, and kept out of the component because these are two deliberately different rules and
 * the difference is easy to erase by accident:
 *
 * - **Typing** a name that happens to match a vendor fires on its own, from characters the
 *   user was entering anyway. It may only fill blanks — it must never take away something
 *   they chose.
 * - **Clicking** a suggestion is a deliberate choice, so it replaces what is already there.
 *   Filling blanks only was the old behaviour, and it meant picking a line item and then
 *   choosing a vendor appeared to do nothing at all.
 *
 * The subtotal is the exception to the click rule. It is offered as a starting point, and the
 * amount is the one field that is genuinely new each time, so a figure already typed is never
 * replaced by a remembered one.
 */
import { centsToDollars } from "@/src/domain/money";

import type { ExpenseInput } from "./actions";

/** One remembered payee. Null amounts mean nothing was learned, which is not zero. */
export type VendorFill = {
  name: string;
  lineItemId: string | null;
  description: string;
  paymentSource: string | null;
  subtotalCents: number | null;
  taxCents: number | null;
  feesCents: number | null;
};

/**
 * A remembered amount as the text a money input holds, or "" when nothing was learned.
 *
 * Zero returns "0.00", not "": a vendor that charges no tax is a fact worth offering, and
 * only `null` means the library has nothing to say.
 */
export function moneyField(cents: number | null): string {
  return cents === null ? "" : centsToDollars(cents).toFixed(2);
}

/**
 * A remembered payment source, but only while the label is still in use.
 *
 * Labels can be retired. A retired one stays readable on the expenses that already carry it
 * (R5.2), but must never be put on a new one — so a vendor last paid through a source that
 * has since been retired simply contributes nothing here.
 */
function usablePaymentSource(
  vendor: VendorFill,
  activeSources: readonly string[],
): string | null {
  if (vendor.paymentSource === null) return null;
  return activeSources.includes(vendor.paymentSource) ? vendor.paymentSource : null;
}

/**
 * A remembered line item, but only while it belongs to the current funding source.
 *
 * The payment source no longer decides the reimbursement flags (Phase 4/D-93) — the form's
 * Funding source field does, applied when it changes. A remembered `lineItemId` that belongs
 * to a *different* source must not cross over, so it falls back to whatever the field already
 * holds (which is `""` on the typed-name path — left empty, per spec).
 */
function usableLineItemId(
  vendor: VendorFill,
  sourceLineItemIds: readonly string[],
  current: string,
): string {
  if (vendor.lineItemId && sourceLineItemIds.includes(vendor.lineItemId)) return vendor.lineItemId;
  return current;
}

/** Applied when the typed name matches a vendor exactly — blanks only. */
export function fillFromTypedName(
  current: ExpenseInput,
  vendor: VendorFill,
  activeSources: readonly string[] = [],
  sourceLineItemIds: readonly string[] = [],
): ExpenseInput {
  // Something already chosen means the user is past this field; leave the whole form alone.
  if (current.lineItemId || current.description) return current;

  return {
    ...current,
    lineItemId: usableLineItemId(vendor, sourceLineItemIds, current.lineItemId),
    description: vendor.description,
    paymentSource: current.paymentSource || (usablePaymentSource(vendor, activeSources) ?? ""),
    subtotal: current.subtotal || moneyField(vendor.subtotalCents),
    tax: current.tax || moneyField(vendor.taxCents),
    fees: current.fees || moneyField(vendor.feesCents),
  };
}

/** Applied when a suggestion is clicked — overwrites, except a subtotal already typed. */
export function fillFromClick(
  current: ExpenseInput,
  vendor: VendorFill,
  activeSources: readonly string[] = [],
  sourceLineItemIds: readonly string[] = [],
): ExpenseInput {
  return {
    ...current,
    name: vendor.name,
    // A vendor with no remembered line item — or one outside the current source — must not
    // blank out one already chosen.
    lineItemId: usableLineItemId(vendor, sourceLineItemIds, current.lineItemId),
    description: vendor.description || current.description,
    paymentSource: usablePaymentSource(vendor, activeSources) ?? current.paymentSource,
    subtotal: current.subtotal || moneyField(vendor.subtotalCents),
    tax: moneyField(vendor.taxCents) || current.tax,
    fees: moneyField(vendor.feesCents) || current.fees,
  };
}
