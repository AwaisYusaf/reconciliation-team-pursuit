/**
 * Pure expense-input validation, kept out of actions.ts deliberately: that file is
 * `"use server"`, and Next.js requires every export from a `"use server"` module to be an
 * async Server Action — a plain synchronous function like this one is a build error there.
 */
import { isValidIsoDate, isValidMonthKey } from "@/src/domain/dates";
import { isUuid } from "@/src/lib/ids";
import { parseMoneyToCents } from "@/src/domain/money";
import { UI } from "@/src/domain/strings";
import type { FieldErrors } from "@/src/lib/action-result";

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

/**
 * How much of the rule set applies.
 *
 * `draft` relaxes exactly two requirements, the two an invoice import can legitimately leave
 * blank: the line item and the narrative (Phase 14, D-115). Nothing else moves, and approving a
 * draft runs the full set again through the normal create path, so a draft can never become a
 * real expense on rules weaker than a hand-typed one's.
 */
export type ValidateOptions = { draft?: boolean };

/** The type the form sends for every field. A `Record` over the keys, so a field added to
 *  `ExpenseInput` does not compile until its type is declared here. */
const SHAPE: Record<Exclude<keyof ExpenseInput, "id">, "string" | "boolean"> = {
  name: "string",
  fundingSourceId: "string",
  lineItemId: "string",
  paymentSource: "string",
  taxReimbursable: "boolean",
  feesReimbursable: "boolean",
  month: "string",
  date: "string",
  description: "string",
  subtotal: "string",
  tax: "string",
  fees: "string",
  note: "string",
  narrative: "string",
  noReceipt: "boolean",
  noReceiptReason: "string",
};

/**
 * Whether a request is shaped like the form's: every text field a string, every checkbox a real
 * boolean. Create, update, the draft save and the invoice route are public endpoints, and the
 * rules below would misread anything else instead of refusing it: the text "false" is truthy (a
 * "No receipt available" nobody ticked, which deletes an expense's receipts on update), and
 * `.trim()` on a number throws past the ActionResult contract (review ledger). The form always
 * sends this shape, so only a crafted call or a foreign client fails it.
 */
function wellShaped(input: unknown): input is ExpenseInput {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  return Object.entries(SHAPE).every(([field, type]) => typeof record[field] === type);
}

/**
 * Create and update's check: a request not shaped like the form's is one panel message;
 * otherwise every field problem at once (usability #25), keyed by field, with every message in
 * `error` too, so a client that reads only `error` still sees them all. Null when it passes.
 */
export function expenseRefusal(input: ExpenseInput): { error: string; fieldErrors?: FieldErrors } | null {
  if (!wellShaped(input)) return { error: UI.requestRefused };
  const fieldErrors = validateFields(input);
  const messages = Object.values(fieldErrors);
  return messages.length > 0 ? { error: messages.join(" "), fieldErrors } : null;
}

/** Every problem with an expense at once, keyed by the ExpenseInput field it belongs to, in the
 *  order the form shows them (usability #25). Assumes a well-shaped input: `expenseRefusal` and
 *  `validate` check that first, so call one of them, not this, from an action or route. */
export function validateFields(input: ExpenseInput, options: ValidateOptions = {}): FieldErrors {
  const draft = options.draft === true;
  const errors: FieldErrors = {};
  if (!input.name.trim()) errors.name = "Enter a name.";
  if (!isUuid(input.fundingSourceId)) errors.fundingSourceId = "Choose a funding source.";
  if (!draft && !input.lineItemId) errors.lineItemId = "Choose a line item.";
  if (!input.paymentSource) errors.paymentSource = "Choose a payment source.";
  if (!isValidMonthKey(input.month)) errors.month = "Choose a month.";
  if (!isValidIsoDate(input.date)) errors.date = "Enter a valid date.";
  if (invalidMoneyField(input.subtotal)) errors.subtotal = "Enter a valid subtotal, like 1234.56.";
  if (invalidMoneyField(input.tax)) errors.tax = "Enter a valid tax amount, like 12.34.";
  if (invalidMoneyField(input.fees)) errors.fees = "Enter a valid fees amount, like 12.34.";
  if (input.noReceipt && !input.noReceiptReason.trim()) errors.noReceiptReason = UI.noReceiptReasonRequired;
  if (!draft && !input.narrative.trim()) errors.narrative = UI.expenseMissingNarrative;
  return errors;
}

/**
 * The first problem, as one sentence, for the paths that show one message: saving a draft
 * (`updateDraftAction`) and the invoice import route. Create and update use `expenseRefusal`.
 * Both start from the same shape check and `validateFields`, so every path enforces the same
 * rules; a well-shaped input gets exactly the messages it always did.
 */
export function validate(input: ExpenseInput, options: ValidateOptions = {}): string | null {
  if (!wellShaped(input)) return UI.requestRefused;
  const errors = validateFields(input, options);
  // The draft and invoice paths show one sentence, so the three "who and how" fields keep
  // their one combined message there (UI.expenseMissingFields).
  if (errors.name || errors.lineItemId || errors.paymentSource) return UI.expenseMissingFields;
  return Object.values(errors)[0] ?? null;
}
