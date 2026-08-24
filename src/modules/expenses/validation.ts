/**
 * Pure expense-input validation, kept out of actions.ts deliberately: that file is
 * `"use server"`, and Next.js requires every export from a `"use server"` module to be an
 * async Server Action — a plain synchronous function like this one is a build error there.
 */
import { isValidIsoDate, isValidMonthKey } from "@/src/domain/dates";
import { parseMoneyToCents } from "@/src/domain/money";
import { UI } from "@/src/domain/strings";

import type { ExpenseInput } from "./actions";

/**
 * A money field left blank means zero (a vendor that charges no tax, an expense with no fees)
 * and is not an error. A money field with something in it that isn't a number — stray text, a
 * stray character, more than one decimal point — must not be silently swallowed into that same
 * zero: `parseMoneyToCentsOrZero` can't tell "nothing typed" from "garbage typed" apart, so the
 * distinction is made here, before either reaches it.
 */
function invalidMoneyField(raw: string): boolean {
  return raw.trim() !== "" && parseMoneyToCents(raw) === null;
}

/** Validation shared by create and update, so both paths enforce the same rules. */
export function validate(input: ExpenseInput): string | null {
  if (!input.name.trim() || !input.lineItemId || !input.paymentSource) {
    return UI.expenseMissingFields;
  }
  if (!isValidMonthKey(input.month)) return "Choose a month.";
  if (!isValidIsoDate(input.date)) return "Enter a valid date.";
  if (invalidMoneyField(input.subtotal)) return "Enter a valid subtotal, like 1234.56.";
  if (invalidMoneyField(input.tax)) return "Enter a valid tax amount, like 12.34.";
  if (invalidMoneyField(input.fees)) return "Enter a valid fees amount, like 12.34.";
  if (input.noReceipt && !input.noReceiptReason.trim()) return UI.noReceiptReasonRequired;
  return null;
}
