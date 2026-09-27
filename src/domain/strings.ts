/**
 * Canonical strings (domain-rules §12).
 *
 * Every string that prints on a submitted document, and every fixed piece of UI copy the
 * rules pin down, lives here and nowhere else. Generators and screens import from this
 * module so wording can never drift between the app, the Word cover sheet, the Excel
 * summary and the packet PDF. Do not inline these strings anywhere.
 */
import type { FeatureRequestStatus } from "@/src/db/schema";
import type { ReadAmounts } from "@/src/domain/amount-suggestion";
import { formatMoney } from "@/src/domain/format";
import { SHARE_PASSWORD_MAX, SHARE_PASSWORD_MIN } from "@/src/domain/shared-links";

/** The product name, everywhere it appears in UI copy, page titles and generated-document fallbacks. */
export const APP_NAME = "Stay Funded 360";

/** A page's `<title>`, in the app's fixed "Section | App Name" form (D-113). */
export function pageTitle(section: string): string {
  return `${section} | ${APP_NAME}`;
}

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
 * anchor on it. The colon stays attached so `pdftotext` reports `(2026-02-014):` as one token,
 * which `pdf-anchors.ts` matches.
 */
export function coverSheetHeading(name: string, reference: string): string {
  return `${name} (${reference}):`;
}

/** Disclosure appended to a heading when the expense has no receipt (R6.7). */
export function noReceiptNote(reason: string): string {
  return `(Note: No receipt available. Reason: ${reason.trim()})`;
}

/* ------------------------------------------------------------------- UI copy */

/** Phase 10 amounts-panel field words, shared by the summary line and each per-file line
 *  (Appendix A §2) — kept as one set so "Subtotal"/"Tax"/"Fees" can never read differently
 *  between the two. */
const AMOUNT_FIELD_LABELS = { subtotal: "Subtotal", tax: "Tax", fees: "Fees" } as const;
const TOTAL_PAID_LABEL = "Total paid";
const TOTAL_REFUNDED_LABEL = "Total refunded";
const TOTAL_LABEL = "Total";

/** "Total paid $165.00", or for money coming back "Total refunded $145.00" — never "Total paid
 *  -$145.00" (PR #18 round 3, #7). */
function totalPaidParts(totalCents: number): { label: string; value: string } {
  return totalCents < 0
    ? { label: TOTAL_REFUNDED_LABEL, value: formatMoney(-totalCents) }
    : { label: TOTAL_PAID_LABEL, value: formatMoney(totalCents) };
}

function amountsLineParts(amounts: ReadAmounts, totalLabel: string): { lead: string; total: string } {
  return {
    lead:
      `${AMOUNT_FIELD_LABELS.subtotal} ${formatMoney(amounts.subtotalCents)} · ` +
      `${AMOUNT_FIELD_LABELS.tax} ${formatMoney(amounts.taxCents)} · ` +
      `${AMOUNT_FIELD_LABELS.fees} ${formatMoney(amounts.feesCents)} · `,
    total: `${totalLabel} ${formatMoney(amounts.totalCents)}`,
  };
}

function amountsLine(amounts: ReadAmounts, totalLabel: string): string {
  const { lead, total } = amountsLineParts(amounts, totalLabel);
  return lead + total;
}

/** Where "contact support" points, everywhere the app says it (D-24). Its own constant so a
 *  message inside `UI` can name it before `UI.supportEmail` exists. */
const SUPPORT_EMAIL = "tech@teampursuit.org";

export const UI = {
  /** Add Expense reimbursable box (R1.3). */
  reimburseHint: "Sales tax is excluded. The funder does not reimburse it.",
  /** Month-End Packet blocking panel title (R4.3). */
  blockedTitle: "This packet cannot be downloaded yet.",
  /** Cover Sheets blocking panel title (R4.3), worded like the packet's own. */
  blockedTitleLineItem: "This cover sheet cannot be downloaded yet.",
  /** Line that introduces the blocking list (R4.4). */
  blockedIntro:
    "The following records are missing a receipt/justification, proof of payment, or narrative:",
  /** Login page — there is no self-serve reset (D-24); email is the escalation path. */
  forgotPassword: "Forgot your password? Email",
  /** The mailbox the login page's "forgot password" link points to (D-24). */
  supportEmail: SUPPORT_EMAIL,
  uploadFailed: "Upload failed. Try again.",
  noReceiptReasonRequired: "Enter the reason no receipt is available.",
  duplicateEmail: "An organization with that email already exists. Sign in instead.",
  signInMissingFields: "Enter your email and password.",
  /** Each user signs in with their own email, and sign-ups are usually closed (PHASE-13 §11 Q2). */
  signInUnknownEmail: "We couldn't find an account with that email. Check the address and try again.",
  signInWrongPassword: "That password doesn't match this email.",
  expenseMissingFields:
    "Enter a name, choose a line item, and choose a payment source.",
  /** m02 — narrative is required at save time (R4.7), unlike receipt/proof which gate only
   *  the download. */
  expenseMissingNarrative: "Enter a narrative for this expense.",
  recurringMissingFields: "Enter a name, an amount, and a line item.",
  lineItemDuplicate: "A line item with that name already exists.",
  signupsClosed: "Sign-ups are closed.",
  /** m02 — saved, but the documentation gate will still hold this record. */
  savedMissingProof: "Expense saved. It's still missing proof of payment.",
  /** Add Expense caution (non-blocking) — tax excluded from reimbursable (R1.3), so a large
   *  tax relative to the subtotal isn't a domain-rule violation, just worth a second look. */
  taxExceedsSubtotalWarning: "Tax is more than the subtotal. Double-check this entry.",
  /** Add Expense caution (non-blocking) — a $0.00 subtotal is allowed, but unusual enough to
   *  flag rather than save silently. */
  subtotalIsZeroWarning: "Subtotal is $0.00. Double-check this entry.",
  /** Refusal on every §2 write to a locked month (R10.7, D-96). */
  monthLocked: (monthLabel: string) =>
    `${monthLabel} is locked. Unlock it on the Month-End Packet tab to make changes.`,
  /** Lock button/upload refusal while the blocking panel shows (R10.7). */
  lockNeedsDocuments: "Add the missing documents before locking this month.",
  /** Lock upload refusal for anything but a PDF (R10.7). */
  lockNotPdf: "Upload the signed packet as a PDF.",
  /** Lock upload refusal — the row was already locked by someone else. */
  monthAlreadyLocked: "This month is already locked.",
  /** Unlock refusal — nothing to undo. */
  monthNotLocked: "This month is not locked.",
  /** Packet header, once locked (Appendix A §1). */
  reconciledLabel: "Reconciled",
  /** Packet header's locked line: "Locked on {date} by {name}" (Appendix A §1). */
  lockedOnBy: (date: string, name: string) => `Locked on ${date} by ${name}`,
  /** Event-history lines and the Reporting periods table (Appendix A §3, §4): "Locked {date} by {name}". */
  lockedBy: (date: string, name: string) => `Locked ${date} by ${name}`,
  /** Event-history lines: "Unlocked {date} by {name}", with the reason quoted when there is one
   *  (Appendix A §3, §4). */
  unlockEventLine: (date: string, name: string, reason: string | null) =>
    `Unlocked ${date} by ${name}${reason ? `: "${reason}"` : ""}`,
  /** Heading over the Packet page's event history (Appendix A §3). */
  lockHistoryTitle: "Lock history",
  /** Link text beside a lock event, opening `/api/files/{eventId}` (Appendix A §1, §3, §4). */
  viewSignedPacket: "View signed packet",
  /** Packet page's own event history — an earlier copy later superseded (Appendix A §3). */
  replacedOn: (date: string) => `Replaced on ${date}`,
  /** Reporting periods' event history — the same fact, inline (Appendix A §4). */
  replacedTag: "(replaced)",
  lockButtonLabel: "Lock month",
  unlockButtonLabel: "Unlock",
  /** Lock dialog (Appendix A §1). */
  lockDialogTitle: (monthLabel: string) => `Lock ${monthLabel}?`,
  lockDialogText:
    "Upload the signed packet from the City. Once locked, this month's expenses can't be changed until someone unlocks it.",
  /** Unlock dialog (Appendix A §3). */
  unlockDialogTitle: (monthLabel: string) => `Unlock ${monthLabel}?`,
  unlockDialogText:
    "Its expenses can be changed again. The signed copy stays saved. Lock the month again when the new signed copy arrives.",
  unlockReasonPlaceholder: "e.g. City asked us to remove the duplicate Staples invoice.",
  /** Unlock refusal past `UNLOCK_REASON_MAX_LENGTH` — the box's `maxLength` stops typing first. */
  unlockReasonTooLong: (max: number) => `Keep the reason under ${max} characters.`,
  statusOpen: "Open",
  statusSubmitted: "Submitted",
  reportingPeriodsTitle: "Reporting periods",
  /** Contract Summary's Reporting periods, and the Packet page's own Submitted marker (Appendix A §4). */
  submittedOn: (date: string) => `Submitted ${date}`,
  /**
   * Login page, correct password on a suspended organization (Phase 9 §3.5, §7) — shown only
   * after the password checks out, never for a wrong one, so the form can't be used to learn
   * whether an address's organization is suspended.
   */
  orgAccessPaused: "Your organization's access is paused. Please contact support.",
  /**
   * A revoked account, shown only after the password checks out — same reason as the paused
   * organization above.
   *
   * Points at the organization rather than at support: an admin inside the org did this and an
   * admin inside the org can undo it, so support is the wrong door.
   */
  signInAccessRevoked:
    "Your access to this organization has been removed. Ask an administrator there if you think this is a mistake.",
  /**
   * The same message with the reason AB Solutions gave when suspending. The reason is staff
   * input, so the suspend dialog says out loud that it is shown here — otherwise an internal
   * note ("chasing Misty about the invoice") ends up in front of the customer.
   */
  /** Staff type the reason, so a closing period of theirs is dropped rather than doubled. */
  orgAccessPausedWithReason: (reason: string) =>
    `Your organization's access is paused: ${reason.trim().replace(/\.+$/, "")}. Please contact support.`,
  /** Under the directory's search box while the query is in flight (Phase 9). */
  searching: "Searching…",
  /** Under the search box while the debounce is still counting down, so a two-second wait
   *  doesn't read as a dead control (Phase 9). */
  searchPendingHint: "Press Enter to search now.",
  /** Directory table, no organizations on the app at all — distinct from "none match", which
   *  would describe a filter the reader has not set (Phase 9). */
  noOrganizationsYet: "No organizations yet.",
  /** Directory pagination bar, shown only past one page (Phase 9). */
  pageOf: (page: number, pageCount: number) => `Page ${page} of ${pageCount}`,
  /** Under a truncated users table on an organization's page (Phase 9). */
  showingUsers: (shown: number, total: number) => `Showing ${shown} of ${total} users.`,
  /** The same, once "View all" has been used and the list has hit its ceiling — there is no
   *  further page to link to (Phase 9). */
  usersCapped: (shown: number, total: number) =>
    `Showing the first ${shown} of ${total} users. The list stops here.`,
  /** App header badge, shown only on the "Reconciliation + AI" plan (Phase 9). */
  planPlusBadge: "Plus",
  /** Admin action refusal for an unknown or non-uuid org id (Phase 9 §5). */
  orgNoLongerExists: "This organization no longer exists.",
  /** `suspendOrgAction` refusal — already suspended (Phase 9 §5, D-98 decision 10). */
  orgAlreadySuspended: "This organization is already suspended.",
  /** Admin action refusal when the dialog was saved without changing anything. A note on its
   *  own writes no History line, so claiming "updated" would be a lie the History contradicts. */
  accountNothingChanged: "Nothing changed. A note on its own is not saved.",
  /** `reinstateOrgAction` refusal — not suspended. */
  orgNotSuspended: "This organization is not suspended.",
  /** `suspendOrgAction` — the reason is required, unlike the optional notes on the other three
   *  admin actions (Phase 9 §7). */
  suspendReasonRequired: "Enter the reason for suspending this organization.",
  /** Under the suspend dialog's Reason box: this text reaches the customer, so staff must not
   *  write an internal note there. */
  suspendReasonShownToCustomer:
    "Anyone from this organization who tries to sign in will see this reason.",
  /** Admin action note refusal past `ACCOUNT_NOTE_MAX_LENGTH`, mirroring `unlockReasonTooLong`. */
  accountNoteTooLong: (max: number) => `Keep the note under ${max} characters.`,
  /** `setComplimentaryAction` refusal — `until` is neither empty nor a valid ISO date. */
  complimentaryUntilInvalid: "Enter a valid end date.",
  /** Suspend dialog (Phase 9 §7, verbatim). */
  suspendDialogTitle: (orgName: string) => `Suspend ${orgName}?`,
  suspendDialogText:
    "Everyone in this organization will be signed out and won't be able to sign in until you reinstate it. None of their data is changed or deleted.",
  /** Reinstate dialog (Phase 9 §7). */
  reinstateDialogTitle: (orgName: string) => `Reinstate ${orgName}?`,
  /** History's last line (Phase 9 §3.8, §6) — built from `organizations.created_at`, no event row. */
  orgSignedUp: "Organization signed up",
  /** `describeAccountEvent` (Phase 9 §5) — `plan_changed` covers plan, status, or both. */
  historyPlanChanged: (fromPlan: string, toPlan: string) =>
    `changed plan from ${fromPlan} to ${toPlan}`,
  historyStatusChanged: (fromStatus: string, toStatus: string) =>
    `changed status from ${fromStatus} to ${toStatus}`,
  historyPlanAndStatusChanged: (fromPlan: string, toPlan: string, fromStatus: string, toStatus: string) =>
    `changed plan from ${fromPlan} to ${toPlan} and status from ${fromStatus} to ${toStatus}`,
  /** Fallback for a `plan_changed` event where before/after are identical — the no-op guard in
   *  `changePlanAction` never writes one, but a dangling sentence is worse than a plain one. */
  historyPlanUnchanged: "changed plan",
  historyComplimentaryGranted: "gave complimentary access",
  historyComplimentaryGrantedUntil: (date: string) => `gave complimentary access until ${date}`,
  historyComplimentaryChangedUntil: (date: string) => `changed complimentary access to end ${date}`,
  historyComplimentaryChangedNoEnd: "changed complimentary access to no end date",
  historyComplimentaryRemoved: "removed complimentary access",
  historySuspended: "suspended access",
  historyReinstated: "reinstated access",
  /** `/a` last sign-in / org-page fields with no value yet (Phase 9 §5, §6). */
  notRecordedYet: "Not recorded yet",
  /** Account details' "Setup finished" field, unset (Phase 9 §6, Appendix A §4). */
  setupNotFinished: "Not finished",
  /** Badge row (Phase 9 §6, D-98): complimentary with no end date. */
  complimentaryLabel: "Complimentary",
  /** Badge row: complimentary with a future (or today's) end date (Appendix A §6). */
  complimentaryUntil: (date: string) => `Complimentary until ${date}`,
  /** Badge row: complimentary whose end date has passed — warning tone (Appendix A §6, §7 Q5). */
  complimentaryEnded: (date: string) => `Complimentary (ended ${date})`,
  /** Badge row: an org with `suspended_at` set (Phase 9 §6). */
  suspendedLabel: "Suspended",
  /** Complimentary access dialog checkbox (Appendix A §6, verbatim). */
  complimentaryCheckboxLabel: "Give this organization free access",
  /** Actions row / modal title, reused by both the trigger button and the `Modal` (Appendix A §5). */
  changePlanTitle: "Change plan",
  /** Actions row / modal title (Appendix A §6). */
  complimentaryAccessTitle: "Complimentary access",
  /** Org page usage card (Phase 9 §6, Appendix A §4): "2 active, 1 archived". */
  usageFundingSources: (active: number, archived: number) => `${active} active, ${archived} archived`,
  /** Org page usage card: "412 total · 38 in September 2026". */
  usageExpenses: (total: number, monthCount: number, currentMonthLabel: string) =>
    `${total} total · ${monthCount} in ${currentMonthLabel}`,
  /** Org page usage card: "212 MB of 5 GB", and its storage-bar `aria-label`. */
  usageStorage: (used: string, limit: string) => `${used} of ${limit}`,
  /** Org page usage card — no expense recorded yet. */
  noneYet: "None yet",
  /** Org page usage card label (Phase 9 §7 Q2). */
  packetsDownloadedLabel: "Packets downloaded",
  /** Org page usage card helper, explaining the §7 Q2 counting rule. */
  /** Sharing a packet by link pins it as a download does (PHASE-12 P8, P22), so it counts too. */
  packetsDownloadedNote: "Counts each packet the first time it was downloaded or shared.",
  /** Directory table's row count line, above the table (Phase 9 §7 Q10). */
  organizationsCount: (n: number) => `${n} organization${n === 1 ? "" : "s"}`,
  /** Directory table empty state (Phase 9 §6). */
  noOrganizationsMatch: "No organizations match these filters.",
  /** Org page users table empty state. */
  noUsersYet: "No users yet.",

  /* --------------------------------------------------------- Phase 10: reading amounts */

  /** Add Expense amounts panel, while files are being read (Appendix A §2). */
  readingDocuments: (n: number) => `Reading ${n} document${n === 1 ? "" : "s"}…`,
  /** Amounts panel title, once reading finishes with at least one figure found (Appendix A §2). */
  amountsFoundTitle: "Amounts found in your documents",
  /** The panel's summary line, and the "Replace the amounts you typed?" dialog body (Appendix
   *  A §2): `Subtotal $150.00 · Tax $9.00 · Fees $6.00 · Total paid $165.00`. */
  amountsSummary: (amounts: ReadAmounts) => {
    const { lead } = amountsLineParts(amounts, TOTAL_PAID_LABEL);
    const { label, value } = totalPaidParts(amounts.totalCents);
    return `${lead}${label} ${value}`;
  },
  /** One receipt's own line (Appendix A §2): `Subtotal $110.00 · Tax $6.60 · Fees $3.40 · Total $120.00`. */
  receiptLineAmounts: (amounts: ReadAmounts) => amountsLine(amounts, TOTAL_LABEL),
  /** Tag after a proof-of-payment file's name in the panel list (Appendix A §2). */
  proofOfPaymentTag: "(proof of payment)",
  /** After a proof line's amount, when it agrees with the receipts' total (Appendix A §2). */
  proofMatches: "✓ matches",
  /** A file the model could not find an amount in, or that failed to read — shown the same way
   *  (Phase 10 §2 "Unreadable and no-amount are shown the same way"). */
  noAmountFound: "No amount found",
  /** Every file in the panel came back with nothing to read (Appendix A §2). */
  /** Amounts panel primary button (Appendix A §2). */
  useTheseAmounts: "Use these amounts",
  /** Amounts panel secondary button (Appendix A §2, §3.5 "Dismiss"). */
  dismiss: "Dismiss",
  /** Confirm dialog before "Use these amounts" overwrites fields already typed (Appendix A §2). */
  replaceTypedAmounts: "Replace the amounts you typed?",
  /** Edit Expense button that starts a read on request (Appendix A §3). */
  readAmountsFromDocuments: "Read amounts from documents",
  /** Settings → Organization switch label (Appendix A §4). */
  readAmountsSwitchLabel: "Read amounts from uploaded documents",
  /** Settings → Organization switch help text (Appendix A §4). */
  readAmountsSwitchHelp:
    "Receipts and proofs of payment are sent to OpenAI to suggest amounts. OpenAI doesn't use them for training. Nothing is saved until you confirm.",
  /** A document with too many pages to read (Phase 10 §3.4; OpenAI bills a PDF per page). */
  /** A file's own row in the panel when it was refused for length — "No amount found" there
   *  reads as the AI having failed (PR #18 review). */
  readAmountsTooLongLine: "Too long to read (over 10 pages). Enter the amounts yourself.",
  readAmountsTooManyPages: (pages: number, limit: number) =>
    `That document has ${pages} pages. Amounts can only be read from documents of up to ${limit} pages. Enter the amounts yourself.`,
  /** An invoice with more pages than `MAX_PAGES_READ` (Phase 14 §2, mirrors `readAmountsTooManyPages`). */
  readInvoiceTooManyPages: (pages: number, limit: number) =>
    `That file has ${pages} pages. Invoices of up to ${limit} pages can be read. For a longer document, add the expenses by hand.`,
  /** The invoice read found no usable charge lines (Phase 14 §2). */
  readInvoiceNothingFound: "We could not find any charges on that invoice. Please add the expenses by hand.",
  /** More than `MAX_INVOICE_LINES` lines were read; only the first 50 came through (Phase 14 §2). */
  readInvoiceTooManyLines: "This invoice has more than 50 lines. The first 50 were read. Add the rest by hand.",
  /* ---------------- Adding expenses from one invoice (Phase 14, D-115) ---------------- */
  /** What the entry point says while the model is working. */
  invoiceReadingButton: "Reading the invoice…",
  /** The one control that starts the whole thing, on the Add Expense screen. It says what it
   *  does rather than where it goes: pressing it opens the file picker and the charges it
   *  finds replace the form. */
  invoiceExtractFromInvoice: "Extract From Invoice",
  /** An invoice may be the bill itself or a photo of it. iPhone photos are converted before
   *  they reach the server (D-111), so HEIC is accepted without being named here. */
  invoiceFileType: "Upload the invoice as a PDF or a photo.",
  /** The one button at the end of the check screen. It writes both kinds at once: the charges
   *  marked as expenses become real expenses, the rest become drafts. */
  /** The org-wide active month changed while these charges were being reviewed. Names the
   *  month they would otherwise have landed in, since that is the surprising part. */
  invoiceMonthChanged: (month: string) =>
    `The month changed to ${month} while you were checking these charges. Nothing was saved. Read the invoice again to add them to ${month}.`,
  /** Files queued on a charge that the save could not attach. The charges themselves are
   *  written either way, so this names what to add again rather than claiming nothing saved —
   *  and it has to be said, because the file is gone from the browser once the screen moves. */
  invoiceFilesNotAttached: (files: Array<{ filename: string; reason: string }>) =>
    files.length === 1
      ? `The charges were saved, but ${files[0].filename} could not be attached. ${files[0].reason} Add it again from the expense.`
      : `The charges were saved, but ${files.length} files could not be attached: ${files
          .map((file) => file.filename)
          .join(", ")}. Add them again from the expense.`,
  /** Charges that were on the bill but whose amount could not be read. Silently dropping them
   *  left a twelve-line invoice arriving as ten charges with nothing said. */
  invoiceUnreadableLines: (count: number) =>
    count === 1
      ? "One charge on this invoice could not be read and is not shown. Add it by hand."
      : `${count} charges on this invoice could not be read and are not shown. Add them by hand.`,
  invoiceDone: "Done",
  /** Done can post a dozen charges and their files in one request; on a slow line that is
   *  several seconds, and a greyed button with no words reads as a page that has stopped. */
  invoiceDoneSaving: "Saving the charges…",
  /** What Done just did, said in the plain terms the person chose it in. */
  invoiceDoneResult: (expenses: number, drafts: number) => {
    const parts: string[] = [];
    if (expenses > 0) parts.push(`${expenses} ${expenses === 1 ? "expense" : "expenses"} added`);
    if (drafts > 0) parts.push(`${drafts} ${drafts === 1 ? "draft" : "drafts"} waiting for review`);
    return parts.length > 0 ? `${parts.join(", and ")}.` : "Nothing was added.";
  },
  /** Done pressed with nothing left to write. The check screen has no tickboxes — charges are
   *  taken off it with Remove — so the wording names the control that actually exists. */
  invoiceNoCharges: "Keep at least one charge, or go back and read another invoice.",
  /** The hint after `draftNeeds`' own missing parts, on a card the person is trying to save as
   *  a real expense straight from the invoice (Phase 14 §3). */
  invoiceOrMarkAsDraft: "You can fill these in now, or mark this charge as a draft and finish it later.",
  /** Next to the draft button when files are queued on the card. A draft holds its own files
   *  (`expense_draft_documents`, migration 0033) and approval moves them onto the expense, so
   *  this says where they go rather than warning they are lost. */
  invoiceDraftKeepsFiles: "These files stay with the draft and move onto the expense when it is approved.",
  /** Discarding a draft removes the files attached to it; Undo brings the draft back without
   *  them, so the toast has to say so rather than promise a whole restore. */
  draftDiscardedWithFiles: "Draft discarded. Its attached files were removed too.",
  /**
   * The same invoice file was already imported into this month (ticket §4).
   *
   * A warning, never a refusal: a vendor really can bill the same lines twice, and the person
   * looking at the paperwork knows better than the app. `by` is already resolved through
   * `userDisplay`, and is left out entirely when the uploading account has since been removed,
   * rather than printing "by Unknown".
   */
  invoiceAlreadyAdded: (date: string, by: string | null) =>
    by
      ? `This invoice was already added on ${date} by ${by}. Adding it again will create these expenses a second time.`
      : `This invoice was already added on ${date}. Adding it again will create these expenses a second time.`,
  /**
   * A tax or fee charged on the whole bill rather than on one line (ticket §2).
   *
   * Said, never split across the lines: dividing one figure between twelve charges would invent
   * a number nobody printed, and the ticket puts splitting out of scope.
   */
  invoiceWholeBillCharge: (amount: string) =>
    `This invoice charges ${amount} on the whole bill, not on any one line. It is not included in the drafts below. Add it as its own expense if it belongs in this month.`,
  /* ---------------- Drafts waiting for review (Phase 14) ---------------- */
  /** The section above the month's expenses, and the mark on each of its rows. */
  draftsWaitingHeading: (count: number) => `Waiting for review (${count})`,
  draftMark: "Draft",
  /**
   * Who last saved a draft, and when.
   *
   * "Saved by", not "edited by": the person who read the invoice in never edited anything, and
   * saying they did would be wrong on the majority of drafts. Saving is the act both the
   * import and a later edit have in common, and it is what the reader is actually asking
   * about — whether someone else has already been through this one.
   */
  draftLastSavedBy: (name: string, date: string) => `Saved by ${name} on ${date}`,
  /** What a draft still needs before it can be approved, in plain words (ticket §5). */
  draftNeedsLineItem: "Needs a line item",
  draftNeedsNarrative: "Needs a narrative",
  /** The three row actions and the section's bulk action. */
  draftApprove: "Approve",
  draftEdit: "Edit",
  draftDiscard: "Discard",
  draftApproveAllReady: (count: number) => `Approve all ready (${count})`,
  /**
   * The result of "Approve all ready" (ticket §5).
   *
   * Always says how many were left, including when none were, so the person never has to work
   * out whether the rest were silently approved too.
   */
  draftsApproved: (approved: number, remaining: number) =>
    remaining === 0
      ? `${approved} ${approved === 1 ? "expense" : "expenses"} approved.`
      : `${approved} ${approved === 1 ? "expense" : "expenses"} approved. ${remaining} still ${remaining === 1 ? "needs" : "need"} your attention.`,
  /** Discard, with the undo offered in the toast itself rather than a trip to Trash (ticket §5). */
  /** Why "Approve all ready" is unavailable. Every draft in the section still needs
   *  something, and each row's own "Still needs" cell says what. */
  /** The same button, once it is showing the drafts: it says the way back, not the way in. */
  draftsBackToExpenses: "Back to expenses",
  draftsNoneReady: "No draft has everything it needs yet.",
  /** Asked before a discard, because the files attached to the draft go with it for good and
   *  Undo brings the row back without them. */
  /** Draft edit: finish the row and make it a real expense in one press. */
  draftSaveAndApprove: "Save and approve",
  draftApprovedOne: "Approved. It counts in the month now.",
  draftDiscardTitle: "Discard this draft?",
  draftDiscardBody: (name: string) =>
    `${name} will be removed. It does not go to Trash, and any files attached to it are deleted. Undo brings the charge back, but not its files.`,
  draftDiscardKeep: "Keep it",
  draftDiscarded: "Draft discarded.",
  draftUndo: "Undo",
  /** Refusal when Approve is somehow reached on a draft that is still missing something. */
  draftNotReady: "This draft is still missing something. Open it and fill in what it needs.",
  /** The same refusal, said on the edit screen itself, where "open it" would be nonsense: the
   *  draft IS open. Names the fields, in the same words the drafts list's "Still needs" uses. */
  draftSavedNotApproved: (needs: string[]) =>
    `Saved, but not approved: ${needs.join(" · ")}.`,
  /** The draft, or the invoice that made it, is gone: someone else discarded or approved it. */
  draftGone: "That draft no longer exists.",
  /** Amounts panel, when some files were read and others were not (Phase 10 §3.5 table — not in
   *  Appendix A, added so an incomplete total is never used unnoticed). */
  amountsLeftOut: "Documents marked No amount found are left out of these totals.",
  /** Receipt line whose total doesn't match its own subtotal + tax + fees (Appendix A §1). */
  receiptDoesNotAddUp: "The amounts on this receipt don't add up. Check them before saving.",
  /** Receipts vs. proofs disagree (Appendix A §1, verbatim with the two figures substituted). */
  proofsDifferWarning: (receipts: string, proofs: string) =>
    `Receipts add up to ${receipts} but proofs of payment show ${proofs}. Check the amounts before saving.`,
  /** Add Expense tour's amounts step, unchanged text — kept when reading is unavailable
   *  (Appendix A §6). */
  tourAmountsBody:
    "Enter the amounts from the receipt. If it includes tax or fees, you'll be asked whether the funder pays for them.",
  /** Add Expense tour's amounts step, once reading is available (Appendix A §6). */
  tourAmountsBodyWithReading:
    "Enter the amounts from the receipt, or use the ones AI finds in the receipt you added above. If it includes tax or fees, you'll be asked whether the funder pays for them.",
  /** Plus upload section note on Add — reading starts on its own (Appendix A §2). */
  aiUploadNoteAdd: "AI reads the amounts when you add a file.",
  /** Plus upload section note on Edit — reading only on request (Appendix A §3). */
  aiUploadNoteEdit: "AI reads the amounts when you press Read amounts from documents.",
  /** A file row's AI status while its read is running. */
  aiFileReading: "Reading amounts…",
  /** Toast while a picked iPhone photo (HEIC) is converted to JPEG in the browser, so it can be
   *  previewed before the expense is saved. Shown on both plans. */
  convertingPhotos: "Preparing your photo…",
  /** A file row's AI status once amounts were found. */
  aiFileFound: (total: string) => `Amounts found · Total ${total}`,
  /** Add Expense tour's proof step, unchanged — kept when reading is unavailable. */
  tourProofBody:
    "Always required. Add a bank transaction or payment screenshot. Without it, the month's packet can't be downloaded.",
  /** Add Expense tour's proof step on Plus: what AI does with a proof. */
  tourProofBodyWithReading:
    "Always required. Add a bank transaction or payment screenshot. Without it, the month's packet can't be downloaded. With Plus, AI reads the amount paid and checks it against your receipts.",
  /** Add Expense tour's receipt step, unchanged — kept when reading is unavailable. */
  tourReceiptBody:
    "Add the receipt, invoice or timesheet. If there isn't one, check No receipt available and give a reason. The reason prints on the cover sheet.",
  /** Add Expense tour's receipt step on Plus: where the amounts appear and that nothing fills
   *  itself — carries the same "reason prints on the cover sheet" sentence as the base
   *  `tourReceiptBody` (PR #18 review #14: the Plus variant had dropped it). */
  tourReceiptBodyWithReading:
    "Add the receipt, invoice or timesheet. With Plus, AI reads its amounts and shows them under Subtotal, Tax and Fees. Nothing is filled in until you press Use these amounts. If there isn't a receipt, check No receipt available and give a reason. The reason prints on the cover sheet.",
  /** Settings tour step for the Plus reading switch (only shown where the switch exists). */
  tourReadAmountsSwitchTitle: "Read amounts with AI",
  tourReadAmountsSwitchBody:
    "Included with Plus. When it's on, AI reads the receipts and proofs of payment added to an expense and suggests the amounts. Nothing is filled in until someone chooses to use them. Only an admin can change this.",
  /** Generic dialog dismiss label — no existing `UI.cancel` before Phase 10; reused here for the
   *  "Replace the amounts you typed?" dialog rather than adding a feature-specific word for it. */
  cancel: "Cancel",
  save: "Save",
  saving: "Saving…",
  done: "Done",
  /** A route's own guards refused the request (origin, size, malformed body) — never expected
   *  from the app's own screens, so it says only what to do. */
  requestRefused: "That couldn't be completed. Reload the page and try again.",

  /* --------------------------------------------------------- Phase 11: monthly summaries */

  /** Base-plan note, in place of the button (Appendix A §1, verbatim). */
  summaryPlanNote: "Monthly summaries are part of the Reconciliation + AI plan.",
  /** Write draft summary refusal — the month has no live expenses (Appendix A §3, verbatim). */
  summaryNoExpenses: "Add expenses to this month first.",
  /** Write/Write again refusal — another run for this org/source/month is already in flight
   *  (P11). Wording to review. */
  summaryAlreadyWriting: (monthLabel: string) =>
    `A summary for ${monthLabel} is already being written. Wait for it to finish, then reload the page.`,
  /** Write/Write again refusal — the model failed, timed out, refused, or was rejected twice
   *  (Appendix A §3, verbatim). */
  summaryWriteFailed: "The summary couldn't be written right now. Try again.",
  /** Save/write conflict — someone else's version won (P10, Appendix A §5 wording). */
  summaryConflict:
    "This summary was changed by someone else. Copy your text, then reload to see their version.",
  /** Write refusal — the per-org rate limit (P11). Wording to review. */
  summaryRateLimited: "Too many summaries were written in the past hour. Try again later.",
  /** Save refusal — over `SUMMARY_MAX_CHARS` (P6, I-26). Wording to review. */
  summaryTooLong: "This summary is longer than 60,000 characters. Shorten it to save.",
  /** `saveSummaryAction` — no row for this org/source/month at all. Wording to review. */
  summaryNotFound: (monthLabel: string) => `There is no summary for ${monthLabel} yet.`,

  /* ---------------------------------------------------- Phase 11 build phase 3: the screen */

  /** Screen and packet-card title (§7.5). Wording to review. */
  summaryTitle: "Monthly summary",
  /** Header on "All" (Appendix A §2, verbatim). */
  summaryPickSource: "Choose a funding source to write its monthly summary.",
  /** Before any summary exists (Appendix A §3, verbatim). */
  summaryIntro: (monthLabel: string) =>
    `Write a draft summary of ${monthLabel} from this month's expenses, descriptions and narratives. You can edit everything before using it.`,
  /** The one generation button before a summary exists (Appendix A §3, verbatim). */
  summaryWriteButton: "Write draft summary",
  /** The one generation button once a summary exists (Appendix A §5, verbatim). */
  summaryWriteAgainButton: "Write again",
  /** While writing (Appendix A §3, verbatim). */
  summaryWriting: "Writing your summary… This can take up to a minute.",
  /** Meta line, first part (Appendix A §5, verbatim form). */
  summaryMetaWritten: (date: string) => `Draft written ${date}`,
  /** Meta line, second part — omitted (not appended) until the first save; the editor's name
   *  is omitted, not the whole clause, when that account was deleted (I-30). */
  summaryMetaEdited: (date: string, name: string | null) =>
    name ? ` · Last edited ${date} by ${name}` : ` · Last edited ${date}`,
  /** Reminder shown above the summary — Appendix A §5 verbatim, as the reviewer asked (PR #18
   *  round 2, #14), in the calm grey note of round 1 #9. */
  summaryAiReminder:
    "This is a draft written by AI from your records. Check every figure and fill in anything in [brackets] before using it.",
  /** Changed-records notice (P7, Appendix A §5, verbatim). */
  summaryChangedNotice: (monthLabel: string) =>
    `Expenses in ${monthLabel} have changed since this summary was written. Write again to include the changes, or edit the text yourself.`,
  /** Copy button label (Appendix A §5, verbatim). */
  summaryCopyText: "Copy text",
  /** Write again confirm dialog (Appendix A §5, verbatim, split for `ConfirmButton`'s title/body). */
  summaryWriteAgainTitle: "Replace this summary with a new draft?",
  summaryWriteAgainBody: "Your edits will be lost.",
  /** Packet card link to the screen (§7.5). Wording to review. */
  summaryOpenLink: "Open monthly summary",
  /** Packet card, no summary yet for this month (§7.5). Wording to review. */
  summaryNoneForMonth: (monthLabel: string) => `No summary for ${monthLabel} yet`,
  /** Saved-months list heading (§7.1). Wording to review. */
  summarySavedHeading: "Saved summaries",
  /** One saved-months row's second line, under the month (§7.1). Wording to review. */
  summarySavedRowDate: (date: string, edited: boolean) => `${edited ? "Last edited" : "Draft written"} ${date}`,
  /** Autosave/Save status (§7.2, PR #18 review #14). */
  summarySave: "Save changes",
  summarySaving: "Saving…",
  summarySaved: "Saved",
  summarySaveFailed: "Couldn't save. Your text is still here.",
  summaryRetry: "Retry",
  /** Copy text outcomes (§7.3, Appendix A wording for the success case). */
  summaryCopied: "Summary copied.",
  summaryCopyRefused: "Couldn't copy. Select the text and copy it yourself.",
  /** The rich editor's two toolbar buttons (PR #18 review #8) — `aria-label`s, since the icons
   *  carry no visible text. */
  summaryBold: "Bold",
  summaryBulletList: "Bullet list",
  /** Download route, when building the file itself fails (Phase 11 §6). */
  summaryPrepareFailed: "The summary couldn't be prepared right now. Try again.",

  /* ----------------------------------------------- /a AI usage card (Phase 11) */

  /** How many of the all-time runs happened this month. */
  aiUsageInMonth: (count: number, monthLabel: string) => `${count} in ${monthLabel}`,
  /** Caption under the unsaved-runs tile. A rejected run always spent tokens, and a failed one
   *  may have, so this must not promise the organisation was charged nothing. */
  aiUsageUnsavedNote: "Nothing was saved. Some of these still used tokens.",
  /** Appended to the cost caption while some runs produced tokens but no cost, which only
   *  happens when the price settings were unset on the server at the time. */
  aiUsageCostIncomplete: "a minimum: some runs happened before prices were set",

  /* ------------------------------------------------ Phase 11 build phase 4: Word and PDF */

  /** Download button labels (Appendix A §5 for Word, verbatim; PDF added by C4). */
  summaryDownloadWord: "Download Word",
  summaryDownloadPdf: "Download PDF",
  /** Both download buttons' disabled reason while there's unsaved text (P13). Wording to review. */
  summaryDownloadUnsaved: "Save your changes to download them.",
  /** PDF conversion failure — the download route's 503 body (P13, Appendix A "Download Word" as
   *  the fallback). Wording to review. */
  summaryPdfFailed: "The PDF couldn't be made right now. Download Word instead.",

  /* ------ Phase 11 build phase 5: Dashboard link and tour */

  /** Dashboard action row, once a summary exists for that source and month (Appendix A, verbatim). */
  summaryReadyLink: "Monthly summary ready",
  /** Packet tour's last step, Plus only (§7.5, B). */
  tourSummaryCardTitle: "Monthly summary",
  tourSummaryCardBody:
    "Included with Plus. Opens the summary screen, where AI writes a draft of this month's summary from your expenses for you to check and edit. It's never part of the packet.",

  /* ----------------------------------------------------------------- Sharing (PHASE-12) */
  // Appendix A verbatim unless marked "wording to review" (PHASE-12 §12).

  shareButton: "Share link",
  shareDialogTitle: (monthLabel: string) => `Share ${monthLabel} files`,
  shareWhichFile: "Which file",
  shareChoicePacket: "Packet (PDF)",
  shareChoicePacketHint: "Opens in the browser. Clickable references work in Chrome, Edge and Safari.",
  shareChoiceSummary: "Summary (Excel)",
  shareChoiceSummaryHint: "Downloads the Excel file.",
  shareAlreadyShared: "Already shared",
  shareRequirePassword: "Require a password",
  sharePasswordLabel: "Password",
  shareCreate: "Create link",
  shareCreatingPacket: "Preparing the packet…",
  /** Wording to review: the ticket only names the packet's busy label. */
  shareCreatingSummary: "Preparing…",
  shareCopy: "Copy link",
  shareCopied: "Link copied.",
  /** Wording to review. */
  shareCopyRefused: "Couldn't copy the link. Select it and copy it yourself.",
  sharePasswordNote: "Password protected. Send the password separately, for example by text.",
  sharedLinksTitle: "Shared links",
  sharedPasswordProtected: "Password protected",
  sharedNoPassword: "No password",
  sharedOn: (date: string, name: string) => `Shared on ${date} by ${name}`,
  shareChangePassword: "Change password",
  shareStop: "Stop sharing",
  shareStopTitle: (monthLabel: string, noun: "packet" | "summary") =>
    `Stop sharing the ${monthLabel} ${noun}?`,
  shareStopBody: "Anyone who has the link won't be able to open it.",
  shareRecordsChanged: (date: string) =>
    `Your records changed since you shared this file on ${date}. The link still gives the older file.`,
  shareUpdate: "Update shared file",
  /** Wording to review. */
  shareUpdated: "Shared file updated.",
  /** Wording to review (P5). Built from the limits so the words can't drift from the check. */
  sharePasswordTooShort: `Use at least ${SHARE_PASSWORD_MIN} characters.`,
  sharePasswordTooLong: `Use at most ${SHARE_PASSWORD_MAX} characters.`,
  sharePasswordHint: `At least ${SHARE_PASSWORD_MIN} characters. You'll need to send it to whoever gets the link.`,
  shareShowPassword: "Show",
  shareHidePassword: "Hide",
  /** Wording to review: the per-user `sharePasswordSet` budget. */
  sharePasswordSetLimited: (minutes: number) =>
    `Too many password changes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  /** Wording to review. */
  sharePasswordAdded: "Password added.",
  sharePasswordChanged: "Password changed.",
  sharePasswordRemoved: "Password removed.",
  /** Wording to review: a second tab or person shared the same file first. */
  shareAlreadyExists: "That file is already shared. Reload the page to see its link.",
  /** Wording to review (P13). */
  shareInProgress: "This file is already being prepared. Wait for it to finish, then reload the page.",
  /** Wording to review: the row was stopped, or never belonged to this organization. */
  shareNoLongerShared: "That link is no longer shared.",
  /** Wording to review (C4): cancelled blocks nothing else, so a cancelled org still sees its rows. */
  shareCancelledNote: "These links don't open while your organization's plan is cancelled.",
  /** Wording to review (C4): sharing is refused outright rather than making a link that can't open. */
  shareCancelledRefused: "Files can't be shared while your organization's plan is cancelled.",
  /** Wording to review: the request never reached the server. */
  shareNetworkFailed: "Couldn't connect. Check your connection and try again.",
  /** Wording to review: the server failed in a way it didn't word itself. */
  shareUnexpected: `The file couldn't be shared. Try again, and if it keeps failing, contact support at ${SUPPORT_EMAIL}.`,
  /** The same, for Update shared file: the link itself still works and still gives the older file. */
  shareUpdateUnexpected: `The shared file couldn't be updated. The link still gives the older file. Try again, and if it keeps failing, contact support at ${SUPPORT_EMAIL}.`,

  // The public pages at /s/… (Appendix A §5).
  sharePasswordProtected: "This file is password protected.",
  shareOpenFile: "Open file",
  sharePasswordWrong: "That password isn't right.",
  /** "15 minutes" is `LIMITS.sharePasswordPerLinkIp.windowMs` — change both together. */
  shareTooManyTries: "Too many tries. Please wait 15 minutes and try again.",
  shareUnavailable: "This link is no longer available. Please ask the sender for a new one.",
  /** Wording to review: Excel links stay on the page after the password, while the file downloads. */
  shareDownloadStarted: "Your download has started.",
  /** Wording to review: the saved file could not be read from storage (never rebuilt, P10). */
  shareOpenFailed: "This file can't be opened right now. Please try again in a few minutes.",
  /** Wording to review: past the per-address open limit (`shareOpen`). */
  shareTooManyOpens: "Too many files opened in a short time. Please wait a few minutes and try again.",

  // PHASE-16 Track A (billing actions)
  billingNotEnabled: "Plan and billing will be available here soon.",
  billingNotAdmin: "Only an admin can change the plan or billing.",
  billingComplimentaryRefused: "Your organization has complimentary access, so there's nothing to pay.",
  billingAlreadySubscribed: "Your organization already has a plan. Use Switch plan to change it.",
  billingPaymentProcessing: "Your last payment is still going through. Try again once it's done.",
  billingUnknownPlan: "That plan isn't available right now.",
  billingNoPlan: "Your organization doesn't have a plan yet.",
  billingPaymentFailedRefused: "Your last payment didn't go through. Update your card before changing plans.",
  billingCancelPending: "Your plan is cancelled. Press Keep my plan before switching.",
  billingPaymentPending: "A switch is waiting for payment. Pay for it or let it expire before making another change.",
  billingChangePending: "A switch is already scheduled. Cancel it first.",
  billingSamePlan: "That's your current plan.",
  billingQuoteExpired: "The price has changed since you opened this. Open it again to see the new figures.",
  billingPortalNotSetUp: `Card and invoices aren't available yet. Email ${SUPPORT_EMAIL}.`,
  billingStripeError: "The payment service didn't respond. Check your plan below before trying again.",
  billingDowngradeTooManySources: (n: number) =>
    `Reconciliation includes one active funding source, and you have ${n}. Archive the ones you don't use in Funding sources, then switch.`,
  staffStripeManaged: "Billing for this organization is managed in Stripe.",
  billingRateLimited: "Too many billing requests. Wait a minute and try again.",

  // PHASE-16 Track B (no free use)
  billingChooseFor: (org: string) => `Choose a plan for ${org}`,
  billingChooseNew: "Choose a plan to get started.",
  billingEnded: "Your plan has ended. Your records are safe and come back as soon as you choose a plan.",
  billingCompEnded: (date: string) =>
    `Your complimentary access ended on ${date}. Your records are safe and come back as soon as you choose a plan.`,
  billingSubscribe: "Continue to payment",
  billingOpeningCheckout: "Opening the payment page…",
  billingUnpaidManager: (names: string) =>
    `Your organization doesn't have an active plan. Your admin (${names}) can choose one in Plan & billing.`,
  billingPlanRequired: "Your organization's plan has ended, so this wasn't saved. Reload the page to see your options.",
  billingChooseDifferent: "Choose a different plan",
  billingIntervalMonthly: "Monthly",
  billingIntervalYearly: "Yearly",
  billingPerMonth: "/month",
  billingPerYear: "/year",

  // PHASE-16 Phase 5 (Plan & billing section, banners, Plus pill)
  billingSectionTitle: "Plan & billing",
  billingComplimentary: (plan: string) => `Your organization has complimentary access to ${plan}.`,
  billingComplimentaryUntil: (plan: string, date: string) =>
    `Your organization has complimentary access to ${plan} until ${date}.`,
  billingQuestions: `Questions about your plan? Email ${SUPPORT_EMAIL}.`,
  billingCompEnding: (date: string) =>
    `Your complimentary access ends on ${date}. After that, you'll be asked to choose a plan to keep working.`,
  billingCheckoutAbandoned: "Payment wasn't finished. Nothing was charged.",
  billingBilledMonthly: "Billed monthly",
  billingBilledYearly: "Billed yearly",
  billingRenews: (date: string) => `Renews on ${date}.`,
  billingSwitchPlan: "Switch plan",
  billingYourPlan: "Your plan",
  billingPortal: "Card and invoices",
  billingPortalHelp: "Opens Stripe's secure page.",
  billingOpeningPortal: "Opening Stripe…",
  billingCancelPlan: "Cancel plan",
  billingKeepPlan: "Keep my plan",
  billingDowngradeQueued: (date: string, plan: string, interval: string) =>
    `On ${date}, your plan switches to ${plan}, billed ${interval}.`,
  billingPriceMoveQueued: (date: string) => `Your plan's price changes on ${date}.`,
  billingCancelChange: "Cancel this change",
  billingCancelling: (date: string) => `Your plan is cancelled. You keep access until ${date}.`,
  billingUpgradeWaiting: (time: string) =>
    `Your plan change is waiting for payment. Pay by ${time} to finish it. If you don't, nothing changes and nothing is charged.`,
  billingPayNow: "Pay now",
  billingPaymentFailed:
    "Your last payment didn't go through. You still have access while we try the card again. Update your card to keep it.",
  billingPaymentFailedManager: (names: string) =>
    `Your organization's last payment didn't go through. Your admin (${names}) can update the card.`,
  billingEndNow: "End plan now",
  billingOnHold:
    "Your last payment didn't go through, so your plan is on hold and the app is paused. Pay the bill or update your card in Card and invoices, or end the plan to choose a new one. Your records are safe.",
  billingOnHoldManager: (names: string) =>
    `Your organization's last payment didn't go through, so the app is paused. Your admin (${names}) can pay the bill or update the card.`,
  billingManagerNote: "Only an admin can change the plan or billing.",
  billingSwitchTitle: (plan: string, interval: string) => `Switch to ${plan}, billed ${interval}?`,
  billingRowCurrent: "Current plan",
  billingRowNew: "New plan",
  billingRowChanges: "Changes",
  billingRowToday: "Charged today",
  billingRowAfter: "After that",
  billingChangesNow: "Right away",
  billingAfterThat: (amount: string, interval: string, date: string) => `${amount} per ${interval} from ${date}`,
  billingUpgradeExplain: (plan: string, date: string) =>
    `Today's charge covers ${plan} until ${date}, less the unused part of what you already paid.`,
  billingDowngradeExplain: (plan: string) =>
    `You keep ${plan} until then. Nothing is charged today, and you can cancel this change any time before it starts.`,
  billingConfirmPay: (amount: string) => `Pay ${amount} and switch`,
  billingConfirmSchedule: (date: string) => `Switch on ${date}`,
  billingSwitching: "Switching…",
  billingSwitchNow: "Switch now",
  billingGoBack: "Go back",
  billingCancelTitle: "Cancel your plan?",
  billingCancelBody: (date: string) =>
    `You keep full access until ${date}. After that, no one in your organization can open the app, download packets or use shared links until you choose a plan again. Your records are kept.`,
  billingCancellingNow: "Cancelling…",
  billingEndNowTitle: "End your plan now?",
  billingEndNowBody:
    "Your last payment didn't go through, so ending your plan now cancels that bill. No one in your organization can use the app until you choose a plan again. Your records are kept.",
  billingEndingNow: "Ending…",
  billingSeePlans: "See plans",
  billingGoToSources: "Go to Funding sources",
  billingSubscribeTooManySources: (count: number) =>
    `Reconciliation includes one active funding source, and you have ${count}. Archive the ones you don't use, or choose Reconciliation + AI.`,
  billingSourcesTitle: "Your funding sources",
  billingSourcesHelp:
    "Reconciliation includes one active funding source. Archiving keeps a source's records, and you can bring it back later from Settings.",
  billingArchiveSource: "Archive",
  billingSourceArchivedToast: "Funding source archived.",
  billingChangedToast: "Your plan has changed.",
  billingScheduledToast: "Your plan change is scheduled.",
  billingCancelledToast: "Your plan is cancelled. You keep access until the end of the paid period.",
  billingResumedToast: "Your plan will continue.",
  billingChangeDroppedToast: "The scheduled change is cancelled.",
  billingEndedToast: "Your plan has ended. Nothing more will be charged.",
  plusPillLabel: "Plus plan, open Plan & billing",
  billingPlansTitle: "Plans",
  billingChangePlan: "Change plan",
  billingHidePlans: "Hide plans",
  billingCheckoutNote: "Cancel anytime. You keep access until the end of the period you paid for.",
  billingCheckoutDeferred: (date: string) =>
    `Nothing is charged today. Your complimentary access continues, and your first payment is on ${date}. Cancel anytime before then and nothing is charged.`,
  billingCheckoutEndsComp:
    "You pay today, and your complimentary access ends once the payment goes through. Cancel anytime. You keep access until the end of the period you paid for.",
  billingCompBuyDeferred: (date: string) =>
    `You can choose a plan now. Nothing is charged until your complimentary access ends: your first payment is on ${date}.`,
  billingCompBuyNow:
    "You can choose a plan now. You pay today, and your complimentary access ends once the payment goes through.",
  billingCompUpcoming: (plan: string, interval: string, date: string) =>
    `Your ${plan} plan, billed ${interval}, starts on ${date}. Nothing is charged before then.`,
  billingCompUpcomingCancelled: "You cancelled the plan you chose, so it won't start and nothing will be charged.",
  billingCancelUpcomingBody:
    "The plan you chose won't start, and nothing will be charged. Your complimentary access continues as before.",
  billingComplimentaryTag: "Complimentary",
  // Staff dashboard (§4.6)
  historyActorStripe: "Stripe",
  staffBillingTitle: "Billing",
  staffBillingNone: "No Stripe subscription.",
  staffBillingStatus: "Stripe status",
  staffBillingInterval: "Billed",
  staffBillingRenews: "Renews on",
  staffBillingEnds: "Ends on",
  staffBillingQueued: "Scheduled change",
  staffBillingQueuedValue: (plan: string, interval: string, date: string) => `${plan}, billed ${interval}, on ${date}`,
  staffBillingPriceMove: (date: string) => `Price change on ${date}`,
  staffBillingUpgradeWaiting: (time: string) => `Upgrade waiting for payment until ${time}`,
  staffBillingPaymentFailed: "Last payment failed. Stripe is retrying the card.",
  staffBillingPaused: "Collection paused while suspended.",
  staffBillingDisputed: (date: string) => `Card dispute opened on ${date}. Review it in Stripe.`,
  staffBillingOpenCustomer: "Open in Stripe",
  staffBillingHeadPaid: "Paid",
  staffBillingHeadFailed: "Payment failed",
  staffBillingHeadNotYet: "Not charged yet",
  staffBillingHeadCancelling: "Paid, cancelling",
  staffBillingHeadCancelled: "Cancelled",
  staffBillingHeadUnfinished: "Payment not finished",
  staffBillingLastPaid: (amount: string, date: string) => `Last payment ${amount} on ${date}.`,
  staffBillingLastPaidLabel: "Last payment",
  staffBillingFirstCharge: (date: string) => `Card saved. The first payment is on ${date}.`,
  staffBillingFirstChargeLabel: "First payment on",
  staffBillingAccessEnds: (date: string) => `Won't renew. Access ends on ${date}.`,
  staffPaymentsTitle: "Payments",
  staffPaymentsNone: "No payments yet.",
  staffPaymentsUnavailable: "Payments can't be loaded from Stripe right now. Reload the page to try again.",
  staffPaymentsView: "View",
  staffPaymentPaid: "Paid",
  staffPaymentOpen: "Due",
  staffPaymentVoid: "Cancelled",
  staffPaymentUncollectible: "Not collected",
  staffPaymentDraft: "Draft",
  staffCompPaying: "This organization pays for a plan. Choose what happens to it.",
  staffCompCancelNow: "Cancel the paid plan now",
  staffCompCancelAtEnd: "Cancel the paid plan at the end of the paid period",
  staffCompCancelRequired: "This organization pays for a plan. Choose whether to cancel it now or at the end of the paid period.",

  // PHASE-16 Track C (landing, funding-source limit)
  fundingSourceLimitReached:
    "Reconciliation includes one active funding source. To add more, try Plus.",
  fundingSourceLimitManager:
    "Reconciliation includes one active funding source. Ask your admin about upgrading.",
  fundingSourceLimitQueued: (date: string) =>
    `Your plan switches to Reconciliation on ${date}, which includes one active funding source. To add another, cancel that switch in Plan & billing.`,

  // PHASE-17: feature requests. The ticket's own words wherever it gives them (Appendix A).
  // "Request" is allowed here: it names the feature, not a web request (Words rule 4).
  featureRequestsTitle: "Feature requests",
  featureRequestsIntro: `Tell us what would make ${APP_NAME} work better for you. Our team reads every request and replies here.`,
  featureRequestSuggest: "Suggest a feature",
  featureRequestSearchLabel: "Search requests",
  featureRequestSearchButton: "Search",
  featureRequestTabAll: "All requests",
  featureRequestTabOrg: "From your organization",
  featureRequestYourOrg: "Your organization",
  /** Ticket §2, on a request of your own that is still waiting for review. */
  featureRequestWaitingNote: "Only your organization can see this until our team reviews it.",
  /** PHASE-17 Q4: any other request of your own that other organizations can't see. */
  featureRequestPrivateNote: "Only your organization can see this.",
  featureRequestTeamReplied: "Our team replied",
  featureRequestVote: "I want this too",
  featureRequestVoted: "You want this",
  featureRequestVotes: (count: number) => (count === 1 ? "1 vote" : `${count} votes`),
  featureRequestSuggestedOn: (date: string) => `Suggested ${date}`,
  /** Left without a name once the author's account is removed, never "by Unknown" (P13). */
  featureRequestSuggestedBy: (name: string | null, date: string) =>
    name ? `Suggested by ${name} on ${date}` : `Suggested on ${date}`,
  featureRequestsEmptyAll: "No feature requests yet. Press Suggest a feature to send the first one.",
  featureRequestsEmptyOrg: "Your organization hasn't suggested anything yet.",
  featureRequestsNoMatch: "No requests match your search.",
  featureRequestsCapped: (shown: number) => `Showing the first ${shown}. Search to find others.`,
  featureRequestDialogTitle: "Suggest a feature",
  featureRequestTitleLabel: "What would you like?",
  featureRequestTitlePlaceholder: "For example: Remind us when receipts are missing before month end",
  featureRequestDetailsLabel: "Tell us more",
  featureRequestDetailsHelp: "What are you trying to do, and how would it help your team?",
  featureRequestSend: "Send request",
  featureRequestSent: "Thanks. Your request was sent to our team.",
  featureRequestTitleRequired: "Enter what you would like.",
  featureRequestDetailsRequired: "Tell us a little more about it.",
  featureRequestTooLong: (max: number) => `Keep this to ${max.toLocaleString("en-US")} characters or fewer.`,
  featureRequestDailyLimit: "You've sent a lot of requests today. Please try again tomorrow.",
  /** The one answer for a request that is missing, hidden from this organization, or (for a
   *  reply) another organization's: the three must be indistinguishable (PHASE-17 P9). */
  featureRequestUnavailable: "This feature request is no longer available.",
  featureRequestVotingClosed: "Votes are closed on this request.",
  featureRequestBack: "Back to feature requests",
  featureRequestRepliesTitle: "Replies",
  featureRequestNoReplies: "No replies yet.",
  featureRequestReplyLabel: "Add a reply",
  featureRequestReplySend: "Send reply",
  featureRequestReplySent: "Reply sent.",
  featureRequestReplyRequired: "Write a reply first.",
  /** How every staff reply is signed, on both sides (ticket §4, open question 4). */
  featureRequestTeamSignature: `${APP_NAME} team`,

  // PHASE-17: feature requests in /a.
  staffSectionOrganizations: "Organizations",
  staffSectionFeatureRequests: "Feature requests",
  staffFeatureRequestsCount: (count: number) =>
    count === 1 ? "1 feature request" : `${count} feature requests`,
  staffFeatureRequestsAllStatuses: "All statuses",
  staffFeatureRequestsEverything: "All requests",
  staffFeatureRequestsNeedsAttention: "Needs attention",
  staffFeatureRequestsNoneYet: "No feature requests yet.",
  staffFeatureRequestsNoneMatch: "No feature requests match these filters.",
  staffFeatureRequestsSearch: "Search requests or organizations",
  staffFeatureRequestUnknownPerson: "Unknown",
  staffFeatureRequestOrganization: "Organization",
  staffFeatureRequestSuggestedBy: "Suggested by",
  staffFeatureRequestSuggestedOn: "Suggested on",
  staffFeatureRequestOriginal: "Original wording",
  staffFeatureRequestEdit: "Edit wording",
  staffFeatureRequestTitleField: "Title",
  staffFeatureRequestDetailsField: "Details",
  staffFeatureRequestSaved: "Wording saved.",
  staffFeatureRequestNothingChanged: "Nothing changed.",
  staffFeatureRequestStatus: "Status",
  staffFeatureRequestStatusSaved: "Status updated.",
  /** A status that can't be shown to others also turns the switch off (PHASE-17 P1), so the toast
   *  says so rather than leaving staff to notice the switch moved. */
  staffFeatureRequestStatusSavedHidden: "Status updated. Other organizations no longer see this request.",
  staffFeatureRequestShowToAll: "Show to all organizations",
  staffFeatureRequestShowToAllHelp:
    "Other organizations see only the title, details, status and votes. They never see who asked or any replies.",
  staffFeatureRequestShowBlocked:
    "Choose a status other than Waiting for review or Already requested first.",
  staffFeatureRequestShown: "Now shown to all organizations.",
  staffFeatureRequestHidden: "Now shown only to its own organization.",
  staffFeatureRequestVotesFrom: (votes: number, orgs: number) =>
    `${votes === 1 ? "1 vote" : `${votes} votes`} from ${orgs === 1 ? "1 organization" : `${orgs} organizations`}`,
  staffFeatureRequestReplyTo: (orgName: string) => `Reply to ${orgName}`,
  staffFeatureRequestNotFound: "That feature request does not exist, or has been deleted.",
  staffFeatureRequestsCapped: (shown: number) => `Showing the newest ${shown}.`,
} as const;

/**
 * `UI.amountsSummary` as four label/value cells, for the panel's figure strip that mirrors the
 * Subtotal/Tax/Fees boxes above it — same words as the sentence, so the two can't drift. A plain
 * export rather than a `UI` entry: the American-spelling guard (`strings.test.ts`) calls every
 * `UI` function expecting a string back, and this one returns a list.
 */
export function amountFigures(amounts: ReadAmounts): { label: string; value: string; total: boolean }[] {
  return [
    { label: AMOUNT_FIELD_LABELS.subtotal, value: formatMoney(amounts.subtotalCents), total: false },
    { label: AMOUNT_FIELD_LABELS.tax, value: formatMoney(amounts.taxCents), total: false },
    { label: AMOUNT_FIELD_LABELS.fees, value: formatMoney(amounts.feesCents), total: false },
    { ...totalPaidParts(amounts.totalCents), total: true },
  ];
}

/** Longest unlock reason — long enough for a real explanation, short enough that nobody pastes a
 *  whole email. Shared so the box's `maxLength` and the server's refusal can't drift apart. */
export const UNLOCK_REASON_MAX_LENGTH = 700;

/** Longest admin note/reason on an org account action — same length and reasoning as
 *  `UNLOCK_REASON_MAX_LENGTH` (Phase 9 §5). */
export const ACCOUNT_NOTE_MAX_LENGTH = 700;

/**
 * Plan and subscription-status labels for the `/a` dashboard (Phase 9 §2). Kept structurally
 * matched to `OrgPlan`/`SubscriptionStatus` (`src/db/schema.ts`) rather than importing those
 * types here, so this domain module stays free of a `db` dependency.
 */
export const PLAN_LABELS: Record<"reconciliation" | "reconciliation_ai", string> = {
  reconciliation: "Reconciliation",
  reconciliation_ai: "Reconciliation + AI",
};

export const STATUS_LABELS: Record<"trial" | "active" | "past_due" | "cancelled", string> = {
  trial: "Trial",
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
};

/**
 * A feature request's status as customers and staff read it (PHASE-17, ticket §5). Keyed by the
 * schema's enum through an erased `import type`, so a status added there fails to compile here
 * until it has words.
 */
export const FEATURE_REQUEST_STATUS_LABELS: Record<FeatureRequestStatus, string> = {
  waiting_for_review: "Waiting for review",
  considering: "Considering",
  planned: "Planned",
  in_progress: "In progress",
  released: "Released",
  not_planned: "Not planned",
  already_requested: "Already requested",
};

/**
 * "What it tells the customer" (ticket §5). Shown only on a request of the reader's own
 * organization: two of them mention a reply, which another organization never sees.
 */
export const FEATURE_REQUEST_STATUS_DESCRIPTIONS: Record<FeatureRequestStatus, string> = {
  waiting_for_review: "Just sent. Our team hasn't looked at it yet.",
  considering: "Our team is thinking about it.",
  planned: "It will be built.",
  in_progress: "It's being built now.",
  released: "It's in the app now.",
  not_planned: "It won't be built. A reply says why.",
  already_requested: "Someone asked for this before. A reply points to the existing request.",
};

/** Inline explanation beside a disabled download button (m07, R4.3). */
export function downloadBlockedReason(count: number): string {
  return `Blocked: ${count} ${count === 1 ? "expense is" : "expenses are"} missing documentation. See the Month-End Packet tab.`;
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
  return parts.join(" | ");
}

/** Packet summary page title (packet-pdf-spec "Canonical section order"), worded like the packet's own title. */
export function packetSummaryTitle(docName: string, monthLabel: string): string {
  return `${docName} ${monthLabel} Contract Summary`;
}

/** Expense index page title (packet-pdf-spec "Canonical section order"), worded like the packet's own title. */
export function packetIndexTitle(docName: string, monthLabel: string): string {
  return `${docName} ${monthLabel} Expense Index`;
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
export function sanitiseForFilename(value: string, maxLength = S3_COMPONENT_MAX): string {
  return (
    value
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/[^A-Za-z0-9._ -]/g, "")
      .replace(/\.{2,}/g, ".")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, maxLength)
      // The trim above runs before the slice, so the slice itself can land on a space or a dot
      // and put one back on the end. Harmless in a display string, not in an S3 key.
      .replace(/[.\s]+$/g, "")
  );
}

/** Default cap, and the one S3 key components keep (`services/storage/keys.ts`). */
const S3_COMPONENT_MAX = 80;

/**
 * The budget a *document* filename's stem gets, which is deliberately larger than the S3
 * component cap above.
 *
 * At 80 the protection `fitSourceName` gives is conditional: it guarantees the month, the
 * document type and the full line item name survive only while those three already fit, and
 * with a real organisation name and month that leaves barely 35 characters for a line item
 * name — so two long line items sharing a prefix still collided, just without the source name
 * being the part that gave way. 150 leaves ~75 for the line item name against realistic
 * inputs, which also drowns out the few characters the budget estimate can undercount by
 * (it measures parts sanitised individually, while the title is sanitised joined). Well under
 * the 255-character limit filesystems and S3 actually impose.
 */
const STEM_MAX = 150;

/**
 * `Team Pursuit February 2026 Salary Breakdown.docx` (R10.3). With a `sourceName` (given only
 * when the organisation has more than one funding source), the source name is inserted between
 * the document name and the month: `Team Pursuit Foundation grant February 2026 Salary
 * Breakdown.docx`. Absent/empty `sourceName` is byte-identical to before.
 *
 * The month, "Breakdown", and the **full** line item name are never shortened — two line
 * items differing only in name must never collapse onto the same file (review fix). Only the
 * source name gives way if the combined title would exceed the stem budget.
 */
export function coverSheetFilename(
  docName: string,
  monthLabel: string,
  lineItemName: string,
  extension: "docx" | "pdf",
  sourceName?: string | null,
): string {
  // Budget estimate only — sanitised copies never reach the output. `docName`/`monthLabel`/
  // `lineItemName` are joined raw below and sanitised once, together, exactly like the no-
  // source path: sanitising a part in isolation trims characters (a trailing period, say)
  // that would have survived in the middle of the full joined string, which is not the same
  // filename as before (a real regression this fix introduced and then caught: "Team/Pursuit
  // & Co." must still keep its period).
  const budgetParts = [
    sanitiseForFilename(docName, STEM_MAX),
    sanitiseForFilename(monthLabel, STEM_MAX),
    sanitiseForFilename(lineItemName, STEM_MAX),
    "Breakdown",
  ].filter(Boolean);
  const source = fitSourceName(sourceName, budgetParts);
  const title = source
    ? [docName, source, monthLabel, lineItemName, "Breakdown"]
        .filter((part) => part && `${part}`.trim())
        .join(" ")
    : coverSheetTitle(docName, monthLabel, lineItemName);
  return `${sanitiseForFilename(title, STEM_MAX)}.${extension}`;
}

/**
 * `Team_Pursuit_February_2026_Summary.xlsx` (R10.3), or with a `sourceName`,
 * `Team_Pursuit_Foundation_grant_February_2026_Summary.xlsx`. The month is never shortened;
 * only the source name gives way (review fix — see `coverSheetFilename`).
 */
export function summaryFilename(docName: string, monthLabel: string, sourceName?: string | null): string {
  return `${underscored(docName, sourceName, monthLabel)}_Summary.xlsx`;
}

/**
 * `Team_Pursuit_February_2026_Packet.pdf` (R10.3), or with a `sourceName`,
 * `Team_Pursuit_Foundation_grant_February_2026_Packet.pdf`. The month is never shortened;
 * only the source name gives way (review fix — see `coverSheetFilename`).
 */
export function packetFilename(docName: string, monthLabel: string, sourceName?: string | null): string {
  return `${underscored(docName, sourceName, monthLabel)}_Packet.pdf`;
}

function underscored(docName: string, sourceName: string | null | undefined, monthLabel: string): string {
  // Same reasoning as `coverSheetFilename`: sanitised copies are for the budget estimate
  // only. The actual title is built from the raw parts and sanitised once, so a boundary
  // character inside `docName` (a trailing period, say) is not treated as if it sat at the
  // edge of the whole filename just because it sat at the edge of `docName` alone.
  const budgetParts = [
    sanitiseForFilename(docName, STEM_MAX),
    sanitiseForFilename(monthLabel, STEM_MAX),
  ].filter(Boolean);
  const source = fitSourceName(sourceName, budgetParts);
  const parts = [docName, source, monthLabel].filter((part) => part && `${part}`.trim());
  return sanitiseForFilename(parts.join(" "), STEM_MAX).replace(/ /g, "_");
}

/**
 * The source-name slice of a filename, shortened only as far as it has to be so the parts that
 * must stay whole — `otherParts`, already sanitised — fit within `STEM_MAX` alongside it.
 *
 * Originally the whole assembled title was cut to 80 characters as one blind slice: a long
 * source name pushed the month or the line item name (or "Breakdown" entirely) past the cut, so
 * two different line items — or two different months — could download under the same filename.
 * Only the source gives way now, dropped altogether if there is no room for it at all.
 *
 * There is deliberately no fixed maximum on top of that budget. A flat 30-character cap used to
 * apply "even with room to spare", and it is what actually produced the reported
 * `…Community Violence Interventio September 2026…`: a 31-character source name lost its last
 * letter with 100 characters of the stem still unused. The budget above already guarantees what
 * that cap was reaching for — the protected parts always fit — so it bounds the source name on
 * its own, without cutting one that fits.
 *
 * Cuts on a whole word where that does not throw away most of the available room, so a
 * genuinely over-long name still reads as a name and not a mid-word fragment.
 */
function fitSourceName(sourceName: string | null | undefined, otherParts: readonly string[]): string {
  if (!sourceName || !sourceName.trim()) return "";
  const sanitised = sanitiseForFilename(sourceName, STEM_MAX);
  if (!sanitised) return "";

  const otherLength = otherParts.reduce((sum, part) => sum + part.length, 0);
  // One space between every part once the source is inserted among them.
  const budget = STEM_MAX - otherLength - otherParts.length;
  if (budget <= 0) return "";
  if (sanitised.length <= budget) return sanitised;

  const cut = sanitised.slice(0, budget);
  const lastSpace = cut.lastIndexOf(" ");
  const wholeWords = lastSpace > budget * 0.6 ? cut.slice(0, lastSpace) : cut;
  return wholeWords.trim();
}

/**
 * Monthly summary section headings, in order (Phase 11, Appendix A §4). The one place this list
 * exists: `checkSummaryStructure` (src/domain/summary-markdown.ts) compares against it, and the
 * prompt and Word builder must read it from here too.
 */
export const SUMMARY_SECTION_TITLES = [
  "Overview",
  "Spending by line item",
  "Budget position",
  "Changes from last month",
  "Items to note",
] as const;

/**
 * Monthly summary document title (Phase 11 §7.4): `Team Pursuit March 2026 Monthly Summary`, or
 * with a source name (given only when the organisation has more than one funding source),
 * `Team Pursuit City of Detroit March 2026 Monthly Summary`. Empty parts are skipped rather than
 * leaving a doubled space.
 */
export function monthlySummaryTitle(docName: string, monthLabel: string, sourceName?: string | null): string {
  return [docName, sourceName, monthLabel, "Monthly Summary"]
    .filter((part) => part && `${part}`.trim())
    .join(" ");
}

/**
 * `Team Pursuit March 2026 Monthly Summary.docx` (or `.pdf`); with a `sourceName`,
 * `Team Pursuit City of Detroit March 2026 Monthly Summary.docx`. Shaped and sanitised exactly
 * like `coverSheetFilename`: the month and "Monthly Summary" are never shortened, only the
 * source name gives way, and the whole title is sanitised once, joined, so a boundary character
 * inside one part is not treated as if it sat at the edge of the filename.
 */
export function monthlySummaryFilename(
  docName: string,
  monthLabel: string,
  extension: "docx" | "pdf",
  sourceName?: string | null,
): string {
  const budgetParts = [
    sanitiseForFilename(docName, STEM_MAX),
    sanitiseForFilename(monthLabel, STEM_MAX),
    "Monthly Summary",
  ].filter(Boolean);
  const source = fitSourceName(sourceName, budgetParts);
  const title = source
    ? [docName, source, monthLabel, "Monthly Summary"].filter((part) => part && `${part}`.trim()).join(" ")
    : monthlySummaryTitle(docName, monthLabel);
  return `${sanitiseForFilename(title, STEM_MAX)}.${extension}`;
}
