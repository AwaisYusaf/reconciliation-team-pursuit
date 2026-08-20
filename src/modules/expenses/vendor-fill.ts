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

/** Applied when the typed name matches a vendor exactly — blanks only. */
export function fillFromTypedName(current: ExpenseInput, vendor: VendorFill): ExpenseInput {
  // Something already chosen means the user is past this field; leave the whole form alone.
  if (current.lineItemId || current.description) return current;

  return {
    ...current,
    lineItemId: vendor.lineItemId ?? current.lineItemId,
    description: vendor.description,
    subtotal: current.subtotal || moneyField(vendor.subtotalCents),
    tax: current.tax || moneyField(vendor.taxCents),
    fees: current.fees || moneyField(vendor.feesCents),
  };
}

/** Applied when a suggestion is clicked — overwrites, except a subtotal already typed. */
export function fillFromClick(current: ExpenseInput, vendor: VendorFill): ExpenseInput {
  return {
    ...current,
    name: vendor.name,
    // A vendor with no remembered line item must not blank out one already chosen.
    lineItemId: vendor.lineItemId ?? current.lineItemId,
    description: vendor.description || current.description,
    subtotal: current.subtotal || moneyField(vendor.subtotalCents),
    tax: moneyField(vendor.taxCents) || current.tax,
    fees: moneyField(vendor.feesCents) || current.fees,
  };
}
