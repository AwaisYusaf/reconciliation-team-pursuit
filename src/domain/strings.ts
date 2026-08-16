/**
 * Canonical strings (domain-rules §12).
 *
 * Every string that prints on a submitted document, and every fixed piece of UI copy the
 * rules pin down, lives here and nowhere else. Generators and screens import from this
 * module so wording can never drift between the app, the Word cover sheet, the Excel
 * summary and the packet PDF. Do not inline these strings anywhere.
 */

/** Printed on a cover sheet heading whenever tax > 0 (R6.5). Exact text — singular "Statement". */
export const TAX_NOTE = "(Note: Statement includes tax which was excluded from reimbursement amount)";

/** The one sentence that follows every cover sheet table (R6.3). */
export const SEE_BELOW = "Please see below for additional information for some of the above items.";

/** Disclosure appended to a heading when the expense has no receipt (R6.7). */
export function noReceiptNote(reason: string): string {
  return `(Note: No receipt available — ${reason.trim()})`;
}

/* ------------------------------------------------------------------- UI copy */

export const UI = {
  /** Add Expense reimbursable box (R1.3). */
  reimburseHint: "Sales tax is excluded. The city does not reimburse it.",
  /** Month-End Packet blocking panel title (R4.3). */
  blockedTitle: "This packet cannot be downloaded yet.",
  /** Cover Sheets blocking panel title (R4.3). */
  blockedTitleLineItem: "Downloads unavailable for this line item.",
  /** Line that introduces the blocking list (R4.4). */
  blockedIntro:
    "The following records are missing a receipt/justification or proof of payment:",
  /** Login page — there is no self-serve reset (D-24). */
  forgotPassword: "Forgot your password? Contact Mantaq.",
  uploadFailed: "Upload failed — try again.",
  noReceiptReasonRequired: "Enter the reason no receipt is available.",
  duplicateEmail: "An organisation with that email already exists — sign in instead.",
  signInMissingFields: "Enter your organisation email and password.",
  signInUnknownEmail:
    "We couldn't find an organisation with that email. Create an account to get started.",
  signInWrongPassword: "That password doesn't match this organisation email.",
  expenseMissingFields:
    "Please enter a name, choose a line item, and choose a payment source.",
  recurringMissingFields: "Enter a name, an amount, and a line item.",
  lineItemDuplicate: "A line item with that name already exists.",
  signupsClosed: "Sign-ups are closed.",
  /** m02 — saved, but the documentation gate will still hold this record. */
  savedMissingProof: "Saved — still missing proof of payment.",
} as const;

/** Inline explanation beside a disabled download button (m07, R4.3). */
export function downloadBlockedReason(count: number): string {
  return `Blocked — ${count} ${count === 1 ? "record is" : "records are"} missing documents. See Month-End Packet.`;
}

/** Refusal message when a line item still has expenses (R9.3). */
export function lineItemDeleteBlocked(name: string): string {
  return `"${name}" has expenses recorded against it and cannot be deleted.`;
}

/* ------------------------------------------------- document titles and names */

/** Cover sheet title: `Team Pursuit February 2026 Analytical Support Breakdown` (R6.1). */
export function coverSheetTitle(
  docName: string,
  monthLabel: string,
  lineItemName: string,
): string {
  return `${docName} ${monthLabel} ${lineItemName} Breakdown`;
}

/** Packet page footer, stamped on every page (R10.5). */
export function packetFooter(
  docName: string,
  monthLabel: string,
  page: number,
  total: number,
): string {
  return `${docName} — ${monthLabel} — Page ${page} of ${total}`;
}

/** Packet summary page title (packet-pdf-spec §1). */
export function packetSummaryTitle(docName: string, monthLabel: string): string {
  return `${docName} — Contract Summary — ${monthLabel}`;
}

/**
 * Sanitiser for every value that reaches a filename or an S3 key component
 * (data-model §S3). Keeps letters, digits, dot, underscore, space and hyphen.
 *
 * Runs of dots are collapsed and leading/trailing dots removed, so a `..` sequence can
 * never survive into a key. Without that, a name like "../../etc" would be stripped of its
 * slashes but keep its dots, producing a key that the `keyBelongsToOrg` guard would then
 * reject — the builder and the validator have to agree.
 */
export function sanitiseForFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[^A-Za-z0-9._ -]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80);
}

/** `Team Pursuit February 2026 Salary Breakdown.docx` (R10.3). */
export function coverSheetFilename(
  docName: string,
  monthLabel: string,
  lineItemName: string,
  extension: "docx" | "pdf",
): string {
  return `${sanitiseForFilename(coverSheetTitle(docName, monthLabel, lineItemName))}.${extension}`;
}

/** `Team_Pursuit_February_2026_Summary.xlsx` (R10.3). */
export function summaryFilename(docName: string, monthLabel: string): string {
  return `${underscored(docName, monthLabel)}_Summary.xlsx`;
}

/** `Team_Pursuit_February_2026_Packet.pdf` (R10.3). */
export function packetFilename(docName: string, monthLabel: string): string {
  return `${underscored(docName, monthLabel)}_Packet.pdf`;
}

function underscored(docName: string, monthLabel: string): string {
  return sanitiseForFilename(`${docName} ${monthLabel}`).replace(/ /g, "_");
}
