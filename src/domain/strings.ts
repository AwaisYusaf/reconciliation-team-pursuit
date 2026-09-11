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

/** The same disclosure when service fees rather than tax are the part not reimbursed. */
export const FEES_NOTE =
  "(Note: Statement includes fees which were excluded from reimbursement amount)";

/** Both at once, so an expense never carries two nearly identical notes. */
export const TAX_AND_FEES_NOTE =
  "(Note: Statement includes tax and fees which were excluded from reimbursement amount)";

/**
 * The disclosure for whatever this funder did not reimburse (R6.5).
 *
 * Its whole purpose is to explain a receipt total that exceeds the amount claimed, so it is
 * printed only when there is a gap to explain — and it names the actual gap. Now that tax can
 * be reimbursable, printing the tax wording unconditionally would put a false statement on a
 * document submitted to the funder (D-67). The tax-only wording is unchanged from the
 * approved February packet.
 */
export function exclusionNote(excluded: ReadonlyArray<"tax" | "fees">): string | null {
  const tax = excluded.includes("tax");
  const fees = excluded.includes("fees");
  if (tax && fees) return TAX_AND_FEES_NOTE;
  if (tax) return TAX_NOTE;
  if (fees) return FEES_NOTE;
  return null;
}

/** The one sentence that follows every cover sheet table (R6.3). */
export const SEE_BELOW = "Please see below for additional information for some of the above items.";

/**
 * An expense's reference, as it is printed and quoted (R2.6).
 *
 * `{month}-{seq}`, e.g. `2026-02-001`. The month is part of the reference because a packet is
 * assembled and submitted one month at a time, so a reference is unambiguous inside the
 * document a reviewer is holding, and sorts into entry order on its own.
 *
 * Three digits covers 999 expenses in a month and simply grows past that rather than
 * truncating — a wrong reference is worse than a wide one.
 */
export function expenseReference(month: string, seq: number): string {
  return `${month}-${String(seq).padStart(3, "0")}`;
}

/**
 * The bold heading above an expense's proofs on the cover sheet (R6.4, D-83).
 *
 * The reference is here, and only here on the sheet: it is the one string unique to the
 * expense — two pay periods for one person print identical table rows — and the packet's links
 * anchor on it. The colon stays attached so `pdftotext` reports `2026-02-014:` as one token.
 */
export function coverSheetHeading(name: string, reference: string): string {
  return `${name} — ${reference}:`;
}

/** Disclosure appended to a heading when the expense has no receipt (R6.7). */
export function noReceiptNote(reason: string): string {
  return `(Note: No receipt available — ${reason.trim()})`;
}

/* ------------------------------------------------------------------- UI copy */

export const UI = {
  /** Add Expense reimbursable box (R1.3). */
  reimburseHint: "Sales tax is excluded. The funder does not reimburse it.",
  /** Month-End Packet blocking panel title (R4.3). */
  blockedTitle: "This packet cannot be downloaded yet.",
  /** Cover Sheets blocking panel title (R4.3). */
  blockedTitleLineItem: "Downloads unavailable for this line item.",
  /** Line that introduces the blocking list (R4.4). */
  blockedIntro:
    "The following records are missing a receipt/justification, proof of payment, or narrative:",
  /** Login page — there is no self-serve reset (D-24); email is the escalation path. */
  forgotPassword: "Forgot your password? Email",
  /** The mailbox the login page's "forgot password" link points to (D-24). */
  supportEmail: "tech@teampursuit.org",
  uploadFailed: "Upload failed — try again.",
  noReceiptReasonRequired: "Enter the reason no receipt is available.",
  duplicateEmail: "An organization with that email already exists — sign in instead.",
  signInMissingFields: "Enter your organization email and password.",
  signInUnknownEmail:
    "We couldn't find an organization with that email. Create an account to get started.",
  signInWrongPassword: "That password doesn't match this organization email.",
  expenseMissingFields:
    "Please enter a name, choose a line item, and choose a payment source.",
  /** m02 — narrative is required at save time (R4.7), unlike receipt/proof which gate only
   *  the download. */
  expenseMissingNarrative: "Enter a narrative for this expense.",
  recurringMissingFields: "Enter a name, an amount, and a line item.",
  lineItemDuplicate: "A line item with that name already exists.",
  signupsClosed: "Sign-ups are closed.",
  /** m02 — saved, but the documentation gate will still hold this record. */
  savedMissingProof: "Saved — still missing proof of payment.",
  /** Add Expense caution (non-blocking) — tax excluded from reimbursable (R1.3), so a large
   *  tax relative to the subtotal isn't a domain-rule violation, just worth a second look. */
  taxExceedsSubtotalWarning: "Tax is more than the subtotal — double-check this entry.",
  /** Add Expense caution (non-blocking) — a $0.00 subtotal is allowed, but unusual enough to
   *  flag rather than save silently. */
  subtotalIsZeroWarning: "Subtotal is $0.00 — double-check this entry.",
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
  /**
   * The expense this page documents, when it documents exactly one (R10.5, D-70).
   *
   * Approved by the funder as an addition to the footer they already receive, rather than a
   * new mark on the page: it is what lets a reviewer holding a receipt find the claim it
   * supports, and the index find the receipt. Absent on the summary, the index, month
   * documents and cover sheets, none of which belong to a single expense.
   */
  reference?: string | null,
): string {
  const parts = [docName, monthLabel];
  if (reference) parts.push(reference);
  parts.push(`Page ${page} of ${total}`);
  return parts.join(" — ");
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

/**
 * `Team Pursuit February 2026 Salary Breakdown.docx` (R10.3). With a `sourceName` (given only
 * when the organisation has more than one funding source), the source name is inserted between
 * the document name and the month: `Team Pursuit Foundation grant February 2026 Salary
 * Breakdown.docx`. Absent/empty `sourceName` is byte-identical to before.
 */
export function coverSheetFilename(
  docName: string,
  monthLabel: string,
  lineItemName: string,
  extension: "docx" | "pdf",
  sourceName?: string | null,
): string {
  const title = sourceName && sourceName.trim()
    ? [docName, sourceName, monthLabel, lineItemName, "Breakdown"].filter((part) => part && part.trim()).join(" ")
    : coverSheetTitle(docName, monthLabel, lineItemName);
  return `${sanitiseForFilename(title)}.${extension}`;
}

/**
 * `Team_Pursuit_February_2026_Summary.xlsx` (R10.3), or with a `sourceName`,
 * `Team_Pursuit_Foundation_grant_February_2026_Summary.xlsx`.
 */
export function summaryFilename(docName: string, monthLabel: string, sourceName?: string | null): string {
  return `${underscored(docName, sourceName, monthLabel)}_Summary.xlsx`;
}

/**
 * `Team_Pursuit_February_2026_Packet.pdf` (R10.3), or with a `sourceName`,
 * `Team_Pursuit_Foundation_grant_February_2026_Packet.pdf`.
 */
export function packetFilename(docName: string, monthLabel: string, sourceName?: string | null): string {
  return `${underscored(docName, sourceName, monthLabel)}_Packet.pdf`;
}

function underscored(docName: string, sourceName: string | null | undefined, monthLabel: string): string {
  const parts = [docName, sourceName, monthLabel].filter((part) => part && part.trim());
  return sanitiseForFilename(parts.join(" ")).replace(/ /g, "_");
}
