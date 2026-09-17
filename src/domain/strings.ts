/**
 * Canonical strings (domain-rules §12).
 *
 * Every string that prints on a submitted document, and every fixed piece of UI copy the
 * rules pin down, lives here and nowhere else. Generators and screens import from this
 * module so wording can never drift between the app, the Word cover sheet, the Excel
 * summary and the packet PDF. Do not inline these strings anywhere.
 */
import type { ReadAmounts } from "@/src/domain/amount-suggestion";
import { formatMoney } from "@/src/domain/format";

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

/** Phase 10 amounts-panel field words, shared by the summary line and each per-file line
 *  (Appendix A §2) — kept as one set so "Subtotal"/"Tax"/"Fees" can never read differently
 *  between the two. */
const AMOUNT_FIELD_LABELS = { subtotal: "Subtotal", tax: "Tax", fees: "Fees" } as const;
const TOTAL_PAID_LABEL = "Total paid";
const TOTAL_LABEL = "Total";

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
    `Unlocked ${date} by ${name}${reason ? ` — "${reason}"` : ""}`,
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
   * The same message with the reason AB Solutions gave when suspending. The reason is staff
   * input, so the suspend dialog says out loud that it is shown here — otherwise an internal
   * note ("chasing Misty about the invoice") ends up in front of the customer.
   */
  orgAccessPausedWithReason: (reason: string) =>
    `Your organization's access is paused: ${reason}. Please contact support.`,
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
  packetsDownloadedNote: "Counts each packet the first time it was downloaded.",
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
  amountsSummary: (amounts: ReadAmounts) => amountsLine(amounts, TOTAL_PAID_LABEL),
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
  /** Amounts panel, when some files were read and others were not (Phase 10 §3.5 table — not in
   *  Appendix A, added so an incomplete total is never used unnoticed). */
  amountsLeftOut: "Documents marked No amount found are left out of these totals.",
  /** Receipt line whose total doesn't match its own subtotal + tax + fees (Appendix A §1). */
  receiptDoesNotAddUp: "The amounts on this receipt don't add up. Please check them.",
  /** Receipts vs. proofs disagree (Appendix A §1, verbatim with the two figures substituted). */
  proofsDifferWarning: (receipts: string, proofs: string) =>
    `Receipts add up to ${receipts} but proofs of payment show ${proofs}. Check the amounts before saving.`,
  /** Add Expense tour's amounts step, unchanged text — kept when reading is unavailable
   *  (Appendix A §6). */
  tourAmountsBody:
    "Enter the amounts from the receipt. If there's tax or fees, you'll be asked whether the funder pays for them.",
  /** Add Expense tour's amounts step, once reading is available (Appendix A §6). */
  tourAmountsBodyWithReading:
    "Enter the amounts from the receipt, or use the amounts we find in the receipt you added above. If there's tax or fees, you'll be asked whether the funder pays for them.",
  /** Plus upload section note on Add — reading starts on its own (Appendix A §2). */
  aiUploadNoteAdd: "AI reads the amounts when you add a file.",
  /** Plus upload section note on Edit — reading only on request (Appendix A §3). */
  aiUploadNoteEdit: "AI reads the amounts when you press Read amounts from documents.",
  /** A file row's AI status while its read is running. */
  aiFileReading: "Reading amounts…",
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
    "Add the receipt, invoice or timesheet. If there isn't one, tick No receipt available and give a reason. The reason prints on the cover sheet.",
  /** Add Expense tour's receipt step on Plus: where the amounts appear and that nothing fills itself. */
  tourReceiptBodyWithReading:
    "Add the receipt, invoice or timesheet. With Plus, AI reads its amounts and shows them under Subtotal, Tax and Fees. Nothing is filled in until you press Use these amounts. If there isn't a receipt, tick No receipt available and give a reason.",
  /** Settings tour step for the Plus reading switch (only shown where the switch exists). */
  tourReadAmountsSwitchTitle: "Read amounts with AI",
  tourReadAmountsSwitchBody:
    "Included with Plus. When it's on, receipts and proofs of payment added to an expense are read by AI to suggest the amounts. Nothing is filled in until someone chooses to use them. Only an admin can change this.",
  /** Generic dialog dismiss label — no existing `UI.cancel` before Phase 10; reused here for the
   *  "Replace the amounts you typed?" dialog rather than adding a feature-specific word for it. */
  cancel: "Cancel",

  /* --------------------------------------------------------- Phase 11: monthly summaries */

  /** Base-plan note, in place of the button (Appendix A §1, verbatim). */
  summaryPlanNote: "Monthly summaries are part of the Reconciliation + AI plan.",
  /** Write draft summary refusal — the month has no live expenses (Appendix A §3, verbatim). */
  summaryNoExpenses: "Add expenses to this month first.",
  /** Write/Write again refusal — another run for this org/source/month is already in flight
   *  (P11). Wording to review. */
  summaryAlreadyWriting: (monthLabel: string) => `A summary for ${monthLabel} is already being written.`,
  /** Write/Write again refusal — the model failed, timed out, refused, or was rejected twice
   *  (Appendix A §3, verbatim). */
  summaryWriteFailed: "The summary couldn't be written right now. Please try again.",
  /** Save/write conflict — someone else's version won (P10, Appendix A §5 wording). */
  summaryConflict:
    "This summary was changed by someone else. Copy your text, then reload to see their version.",
  /** Write refusal — the per-org rate limit (P11). Wording to review. */
  summaryRateLimited: "Too many summaries at once. Try again shortly.",
  /** Save refusal — over `SUMMARY_MAX_CHARS` (P6, I-26). Wording to review. */
  summaryTooLong: "This summary is longer than 60,000 characters. Shorten it to save.",
  /** `saveSummaryAction` — no row for this org/source/month at all. Wording to review. */
  summaryNotFound: (monthLabel: string) => `There is no summary for ${monthLabel} yet.`,
} as const;

/**
 * `UI.amountsSummary` split just before "Total paid", so the panel can render that part bold
 * without parsing the joined sentence back apart. A plain export rather than a `UI` entry: the
 * American-spelling guard (`strings.test.ts`) calls every `UI` function expecting a string
 * back, and this one returns a pair.
 */
export function amountsSummaryParts(amounts: ReadAmounts): { lead: string; totalPaid: string } {
  const { lead, total } = amountsLineParts(amounts, TOTAL_PAID_LABEL);
  return { lead, totalPaid: total };
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
