"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";
import {
  FieldError,
  Helper,
  Input,
  Label,
  MoneyInput,
  Textarea,
} from "@/src/components/ui/field";
import { Select } from "@/src/components/ui/select";
import { DangerPanel } from "@/src/components/ui/surfaces";
import toast from "react-hot-toast";

import { reportResult } from "@/src/components/ui/toast";
import { setActiveFundingSourceAction } from "@/src/modules/auth/actions";
import { projectedRemainingCents } from "@/src/domain/budget-math";
import { compareMonthKeys, formatDateUS, monthLabel } from "@/src/domain/dates";
import { draftNeeds } from "@/src/domain/draft-rules";
import { formatMoney } from "@/src/domain/format";
import {
  parseMoneyToCents,
  parseMoneyToCentsOrZero,
  excludedParts,
  receiptTotalCents,
  reimbursableCents as domainReimbursable,
} from "@/src/domain/money";
import {
  aggregateAmountSuggestion,
  aggregateReceiptDetails,
  amountsMatchSuggestion,
  panelVisible,
  readingFor,
  type ReadableFile,
} from "@/src/domain/amount-suggestion";
import { sameName } from "@/src/domain/vendor-match";
import { exclusionNote, UI } from "@/src/domain/strings";
import { SESSION_EXPIRED, type ActionResult, type FieldErrors } from "@/src/lib/action-result";
import { cn } from "@/src/lib/cn";

import { AmountSuggestionPanel, ReceiptDetailsSuggestion } from "./amount-suggestion-panel";
import { useAmountReads, type AmountReadInput } from "./use-amount-reads";
import {
  fillFromClick,
  fillFromTypedName,
  type VendorFill,
} from "./vendor-fill";
import {
  createExpenseAction,
  deleteExpenseAction,
  removeExpenseDocumentAction,
  searchVendorsAction,
  updateExpenseAction,
  type ExpenseInput,
} from "./actions";
import type { AttachedDocument } from "./queries";
import { canSave } from "./can-save";
import { savedMessage as savedMessageFor } from "./saved-message";
import { UploadField, type PendingUpload } from "./upload-field";
import type { DocumentScope } from "@/src/services/storage/keys";

export type FormOptions = {
  /** Active sources, plus the expense's own source on edit even when it is archived. */
  fundingSources: Array<{
    id: string;
    name: string;
    taxReimbursable: boolean;
    feesReimbursable: boolean;
  }>;
  /** Keyed by funding source id, covering exactly the sources in `fundingSources`. */
  lineItemsBySource: Record<string, Array<{ id: string; name: string }>>;
  paymentSources: string[];
  supportingDocTypes: string[];
  months: string[];
};

export type RemainingByLineItem = Record<string, number>;

export type ExpenseFormProps = {
  options: FormOptions;
  /** Remaining budget per line item for the active month, for the live projection (R3.7). */
  remaining: RemainingByLineItem;
  /**
   * The same figures for every selectable month, so the projection follows the Month
   * dropdown. Present in edit mode, where changing the month moves the expense (R2.2);
   * absent on the add form, where the month is simply the one being created into.
   */
  remainingByMonth?: Record<string, RemainingByLineItem>;
  /** Submission dates keyed `"{sourceId}:{month}"`, already formatted — for the R10.6 warning. */
  submittedOn?: Record<string, string>;
  /** Every locked `"{sourceId}:{month}"` in the org (Appendix A §2, D-96). */
  lockedMonths?: string[];
  today: string;
  activeMonth: string;
  /** New = the header's selection or the org's first active source; edit = the expense's own. */
  initialFundingSourceId: string;
  /** Whether this organisation can read amounts from documents right now (Phase 10, D-105) —
   *  resolved once, server-side, via `readAmountsAllowedForOrg`. */
  readAmounts: boolean;
  /**
   * The organisation's current header selection — `null` when "All" is active. Distinct from
   * `initialFundingSourceId`: on edit, that is the expense's *own* source, which need not be
   * what the header is showing. Used only to decide, after a successful save, whether the
   * header needs to follow the source actually saved to (review fix — see the submit handler).
   */
  headerSelectedSourceId: string | null;
  /** Present in edit mode. */
  existing?: {
    id: string;
    values: ExpenseInput;
    documents: AttachedDocument[];
    /** The saved reimbursable amount, restored before projecting so an edit cannot double-count. */
    savedReimbursableCents: number;
    /** The date the month was submitted, already formatted — null when it was not. */
    monthSubmittedOn: string | null;
  };
  /** Present only for a draft edit: saves through `updateDraftAction` instead of
   *  `updateExpenseAction`, and switches the form into draft mode (no delete). */
  saveAction?: (input: ExpenseInput) => Promise<ActionResult>;
  /** Draft edit only: saves, then approves in one press. Absent when the draft is not ready,
   *  so the button is simply not offered rather than offered and refused. */
  approveAction?: (id: string) => Promise<ActionResult<{ id: string }>>;
  /** Which table an already-attached file is removed from. A draft's files live in
   *  `expense_draft_documents` until approval, so the draft edit page passes its own action;
   *  everywhere else the default reaches `expense_documents`. */
  removeDocumentAction?: (documentId: string) => Promise<ActionResult>;
  /**
   * The invoice this expense or draft came from, shown in the receipt field as something that
   * can be opened.
   *
   * Deliberately not a queued upload and not an attached document: the invoice is stored once,
   * owned by the import, and becomes a real receipt row when the charge is created. Showing it
   * here is how someone checking a draft can see the bill it was read from.
   */
  invoiceReceipt?: { filename: string; href?: string; file?: File };
  /** Present only when this form is one charge card on the invoice screen (Phase 14). The
   *  invoice fixes the funding source and month for every charge, the form creates through
   *  `save.action` instead of `createExpenseAction`, and it stays on the page afterwards
   *  instead of navigating to the Expenses list. */
  embedded?: {
    /** Seeded into the form's initial state, merged over the empty-form defaults — there is no
     *  `existing` on this path, so this is the only way a card arrives prefilled. */
    initialValues?: Partial<ExpenseInput>;
    /** Full rules. Writes nothing: it marks the card, and the id it returns is the CARD's, not
     *  an expense's. No upload runs here — the queued files ride to the server with Done. */
    save: { label: string; action: (input: ExpenseInput) => Promise<ActionResult<{ id: string }>> };
    /** Relaxed rules (the card posts kind "draft"). No uploads run here: there is no draft
     *  row of its own yet; the card holds them and the one Done request attaches them to
     *  whichever row it creates. */
    draft: { label: string; action: (input: ExpenseInput) => Promise<ActionResult> };
    /** Called after either succeeds, so the card can collapse and show its saved state. */
    onSaved: (kind: "expense" | "draft") => void;
    /**
     * Mirrors the files queued on this form up to the card that owns it.
     *
     * Nothing is written until the whole invoice is submitted, so these cannot be uploaded
     * here: there is no expense yet to attach them to. The card holds them and they travel
     * with the one request that creates everything.
     */
    onQueuedChange?: (
      files: Array<{ scope: DocumentScope; file: File; supportingType: string | null }>,
    ) => void;

  };
};

/** Long enough for a one-minute rate-limit window to have rolled over. */
const RATE_LIMIT_RETRY_MS = 6_000;

const EMPTY: ExpenseInput = {
  name: "",
  fundingSourceId: "",
  lineItemId: "",
  paymentSource: "",
  month: "",
  date: "",
  description: "",
  subtotal: "",
  tax: "",
  fees: "",
  taxReimbursable: false,
  feesReimbursable: true,
  note: "",
  narrative: "",
  noReceipt: false,
  noReceiptReason: "",
};

/**
 * The invoice this charge came from, shown the way an attached file is shown elsewhere: a row
 * with a document icon that opens it. The object URL is made once per file and released when
 * the card unmounts, so opening twelve cards does not leak twelve blobs.
 */
function InvoiceReceiptChip({ filename, href, file }: { filename: string; href?: string; file?: File }) {
  // A stored invoice has a real URL. One still sitting on the check screen has only the picked
  // file, so its blob URL is made at the moment someone asks to see it and released shortly
  // after: making it up front would leak one per card on a twelve line invoice.
  function openPickedFile() {
    if (!file) return;
    const url = URL.createObjectURL(file);
    // No `noreferrer` here, unlike every other link in this app: it opens the tab in a context
    // that cannot resolve a blob URL, which Chrome reports as ERR_FILE_NOT_FOUND. There is no
    // referrer to leak anyway, since the URL never leaves this browser.
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="mt-2.5 flex items-center gap-2.5 rounded-[3px] border border-line bg-surface px-3 py-2">
      <svg viewBox="0 0 20 20" aria-hidden="true" className="w-4 h-4 flex-none text-sub">
        <path
          d="M5 2.5h6l4 4v11H5zM11 2.5V7h4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
      <span className="flex-1 text-[14px] truncate">{filename}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-[14px] underline whitespace-nowrap">
          Open
        </a>
      ) : (
        <button type="button" onClick={openPickedFile} className="text-[14px] underline whitespace-nowrap">
          Open
        </button>
      )}
    </div>
  );
}

export function ExpenseForm({
  options,
  remaining,
  remainingByMonth,
  submittedOn,
  lockedMonths = [],
  today,
  activeMonth,
  initialFundingSourceId,
  headerSelectedSourceId,
  readAmounts,
  existing,
  saveAction,
  approveAction,
  removeDocumentAction,
  invoiceReceipt,
  embedded,
}: ExpenseFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const editing = Boolean(existing);
  const draftMode = saveAction !== undefined;

  const initialSource = options.fundingSources.find((source) => source.id === initialFundingSourceId);

  const [values, setValues] = useState<ExpenseInput>(
    existing?.values ?? {
      ...EMPTY,
      fundingSourceId: initialFundingSourceId,
      month: activeMonth,
      date: today,
      ...(initialSource
        ? {
            taxReimbursable: initialSource.taxReimbursable,
            feesReimbursable: initialSource.feesReimbursable,
          }
        : {}),
      ...(embedded?.initialValues ?? {}),
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);
  const focusFirstError = useRef(false);
  const [autofilled, setAutofilled] = useState(false);
  const [suggestions, setSuggestions] = useState<VendorFill[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Ticking "No receipt available" is a destructive act when receipts are already attached:
  // the save deletes every one of them (R4.2). It used to only warn, and the tick immediately
  // hid the list, so the files were out of sight before the warning was read.
  const [confirmingNoReceipt, setConfirmingNoReceipt] = useState(false);

  // After a refused save, bring the first field in error into view and focus it (#24). Centred,
  // so the floating header can never sit on it. Only after a save: typing clears errors too, and
  // that must not move the cursor.
  useEffect(() => {
    if (!focusFirstError.current) return;
    focusFirstError.current = false;
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.scrollIntoView({ block: "center" });
    first?.focus({ preventScroll: true });
  }, [fieldErrors]);

  const attachedReceipts =
    existing?.documents.filter((doc) => doc.kind === "receipt") ?? [];

  function applyNoReceipt(checked: boolean) {
    set("noReceipt", checked);
    // R4.2: drop any queued receipt files too, or they would upload after the save and leave
    // the expense both marked "no receipt" and holding one.
    if (checked)
      setQueued((current) =>
        current.filter((item) => item.scope !== "receipt"),
      );
    // The reason field disappears, so its error must not linger in the summary.
    else
      setFieldErrors((current) => {
        if (!("noReceiptReason" in current)) return current;
        const next = { ...current };
        delete next.noReceiptReason;
        return next;
      });
  }

  // The active labels, plus whatever this expense was actually saved with. A retired label
  // is only offered on the record that already carries it, so it can be kept but never
  // newly chosen (R5.2).
  const selectablePaymentSources = options.paymentSources.includes(
    values.paymentSource,
  )
    ? options.paymentSources
    : [...options.paymentSources, values.paymentSource].filter(Boolean);

  // The line items offered — and everything vendor autofill may cross-check against — are
  // always just the currently selected funding source's own list (spec §4: the line item
  // list only shows that source's line items).
  const sourceLineItems = options.lineItemsBySource[values.fundingSourceId] ?? [];
  // Resolved from the source a state update actually lands on, never captured at render: a
  // fresh array here was a dependency of the vendor-search effect, which re-ran on every
  // render and, with the compiler off, looped a timer and a server call every 250 ms. It also
  // let a search started under one source autofill a line item into the next.
  const lineItemIdsFor = (fundingSourceId: string) =>
    (options.lineItemsBySource[fundingSourceId] ?? []).map((item) => item.id);

  // On the add form files are held until the expense exists, then uploaded against it.
  const [queued, setQueued] = useState<PendingUpload[]>([]);
  // Held in a ref so the effect below depends only on `queued`: `embedded` is rebuilt inline
  // by the card on every render, and depending on it directly would loop.
  const onQueuedChangeRef = useRef(embedded?.onQueuedChange);
  useEffect(() => {
    onQueuedChangeRef.current = embedded?.onQueuedChange;
  });
  useEffect(() => {
    // `supportingType` travels with the file. Without it the server refuses a supporting
    // document ("Choose a document type first.") and the file is lost in silence.
    onQueuedChangeRef.current?.(
      queued.map((item) => ({
        scope: item.scope,
        file: item.file,
        supportingType: item.supportingType ?? null,
      })),
    );
  }, [queued]);
  // A picked HEIC is still becoming a JPEG in the browser (PR #18 round 2, #6).
  const converting = queued.some((item) => item.converting);
  const [status, setStatus] = useState<string | null>(null);

  // --------------------------------------------------------- Phase 10: reading amounts
  // On Add, reading starts as soon as a receipt/proof is chosen. On Edit, nothing reads until
  // "Read amounts from documents" is pressed (Appendix A §3) — `requested` flips that on.
  const [requested, setRequested] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  // The file set the "Replace the amounts you typed?" confirm was opened for. Keyed to the set
  // rather than a boolean: if a file is added or removed while it is open, the suggestion it
  // was asking about is gone, and a plain `true` would pop the dialog back up by itself once
  // the new read finished.
  const [confirmingUseFor, setConfirmingUseFor] = useState<string | null>(null);

  // Every queued or already-attached receipt/proof — never supporting documents (Appendix A
  // §1). A ticked "No receipt available" drops receipt files entirely, so an expense that is
  // proofs-only reads as exactly that.
  const readableFiles: AmountReadInput[] = [
    ...queued
      .filter((item) => item.scope === "receipt" || item.scope === "proof")
      .filter((item) => !(values.noReceipt && item.scope === "receipt"))
      // Read once it is a JPEG, not the HEIC it is about to stop being.
      .filter((item) => !item.converting)
      .map((item) => ({
        key: item.key,
        kind: item.scope as "receipt" | "proof",
        name: item.file.name,
        source: "upload" as const,
        file: item.file,
      })),
    ...(existing?.documents ?? [])
      .filter((doc) => (doc.kind === "receipt" || doc.kind === "proof") && doc.status === "attached")
      .filter((doc) => !(values.noReceipt && doc.kind === "receipt"))
      .map((doc) => ({
        key: `doc:${doc.id}`,
        kind: doc.kind as "receipt" | "proof",
        name: doc.filename,
        source: "attached" as const,
        documentId: doc.id,
      })),
  ];

  // Add reads on choosing a file; Edit on the button, or on choosing a new file, which then
  // reads the attached ones too (Phase 19 Q8). The vendor and date box is Add and Edit only.
  const { reading: readEnabled, offerDetails } = readingFor({
    allowed: readAmounts,
    editing,
    draft: draftMode,
    embedded: Boolean(embedded),
    requested,
    newFileQueued: readableFiles.some((file) => file.source === "upload"),
  });
  const { results: amountReadResults, signature: amountReadSignature } = useAmountReads({
    files: readableFiles,
    enabled: readEnabled,
  });

  const suggestionFiles: ReadableFile[] = readableFiles.map((file) => ({
    key: file.key,
    name: file.name,
    kind: file.kind,
    result: amountReadResults.get(file.key) ?? { status: "pending" },
  }));
  const suggestion = aggregateAmountSuggestion(suggestionFiles, values.noReceipt);
  const showAmountSuggestionPanel = panelVisible({
    enabled: readEnabled,
    signature: amountReadSignature,
    dismissedFor,
    hasFiles: readableFiles.length > 0,
  });
  // Plus look for the two fields that are read (never Supporting). A file shows a status only
  // once reading is on for it — on Edit, not until the button is pressed.
  const uploadAi = readAmounts
    ? {
        note: draftMode ? UI.aiUploadNoteDraft : editing ? UI.aiUploadNoteEdit : UI.aiUploadNoteAdd,
        statusFor: (key: string) => (readEnabled ? amountReadResults.get(key) : undefined),
      }
    : undefined;

  // --------------------------------------------------------- Phase 19: vendor and date
  // What the receipts name, less whatever the form already holds: pressing Add is what makes a
  // row go away, and a row that would change nothing is never offered.
  const receiptDetails = offerDetails
    ? aggregateReceiptDetails(suggestionFiles, values.noReceipt)
    : null;
  const vendorToOffer =
    receiptDetails?.vendor && !sameName(values.name, receiptDetails.vendor)
      ? receiptDetails.vendor
      : null;
  const dateToOffer =
    receiptDetails?.date && receiptDetails.date !== values.date ? receiptDetails.date : null;

  // The name the receipt's Add just set, read once by the vendor lookup below: a remembered
  // vendor then fills its line item, description and payment source but not its amounts, which
  // come from the receipt (vendor-fill.ts, `amounts: false`).
  const nameFromReceipt = useRef<string | null>(null);
  // The field a receipt's Add just changed, lit up briefly like vendor memory's fills: Name
  // sits at the top of the form, well away from the box that changed it.
  const [receiptFilled, setReceiptFilled] = useState<"name" | "date" | null>(null);
  function flashReceiptFill(field: "name" | "date") {
    setReceiptFilled(field);
    setTimeout(() => setReceiptFilled((current) => (current === field ? null : current)), 1400);
  }

  // Add removes its own row, and the next row moves up under the pointer: a second press within
  // half a second is the rest of a double-click, not a choice to add that one too.
  const lastReceiptAdd = useRef(-Infinity);
  // Where focus goes once the row that held it is gone (read by the effect below `fieldId`).
  const receiptBoxRef = useRef<HTMLDivElement>(null);
  const refocusAfterAdd = useRef<{ field: "name" | "date"; fromKeyboard: boolean } | null>(null);
  function receiptAdd(field: "name" | "date", fromKeyboard: boolean, now: number, apply: () => void) {
    if (now - lastReceiptAdd.current < 500) return;
    lastReceiptAdd.current = now;
    apply();
    flashReceiptFill(field);
    refocusAfterAdd.current = { field, fromKeyboard };
  }

  function addReceiptVendor(vendor: string, fromKeyboard: boolean, now: number) {
    receiptAdd("name", fromKeyboard, now, () => {
      nameFromReceipt.current = vendor.trim();
      set("name", vendor);
    });
  }

  function addReceiptDate(date: string, fromKeyboard: boolean, now: number) {
    // Date only. The reporting month is chosen separately and stays as it is (R2.2).
    receiptAdd("date", fromKeyboard, now, () => set("date", date));
  }

  function applySuggestedAmounts() {
    if (suggestion.state !== "done") return;
    setValues((current) => ({
      ...current,
      subtotal: (suggestion.subtotalCents / 100).toFixed(2),
      tax: (suggestion.taxCents / 100).toFixed(2),
      fees: (suggestion.feesCents / 100).toFixed(2),
    }));
    // The panel stays: it shows "✓ Amounts used" while the fields match (usability #58).
    // Only Dismiss hides it.
    setConfirmingUseFor(null);
  }

  function useSuggestedAmounts() {
    const typedNonZero =
      parseMoneyToCentsOrZero(values.subtotal) !== 0 ||
      parseMoneyToCentsOrZero(values.tax) !== 0 ||
      parseMoneyToCentsOrZero(values.fees) !== 0;
    if (typedNonZero) setConfirmingUseFor(amountReadSignature);
    else applySuggestedAmounts();
  }

  const set = useCallback(
    <K extends keyof ExpenseInput>(key: K, value: ExpenseInput[K]) => {
      setValues((current) => ({ ...current, [key]: value }));
      // Typing into a field clears that field's own error (#24).
      setFieldErrors((current) => {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    },
    [],
  );

  // Vendor autofill, the funding-source change and "Use these amounts" write values without
  // going through `set`, so a field they fill must lose its error too: any field whose value
  // changed since the last render drops its error, whichever path changed it.
  const previousValues = useRef(values);
  useEffect(() => {
    const previous = previousValues.current;
    previousValues.current = values;
    setFieldErrors((current) => {
      const changed = Object.keys(current).filter(
        (key) =>
          key in values &&
          values[key as keyof ExpenseInput] !== previous[key as keyof ExpenseInput],
      );
      if (changed.length === 0) return current;
      const next = { ...current };
      for (const key of changed) delete next[key];
      return next;
    });
  }, [values]);

  const subtotalCents = parseMoneyToCentsOrZero(values.subtotal);

  const taxCents = parseMoneyToCentsOrZero(values.tax);
  const feesCents = parseMoneyToCentsOrZero(values.fees);

  // The whole receipt, whatever is claimed from it — the figure that must match the document
  // being attached (R1.3).
  const receiptTotal = receiptTotalCents({
    subtotalCents,
    taxCents,
    feesCents,
  });

  // Calls the domain rule rather than restating it: this box and the saved record must never
  // be able to disagree, which is exactly what the previous inline copy allowed. Not memoised
  // — it is three additions, and the memo could not be preserved across the derived inputs.
  const reimbursableCents = domainReimbursable({
    subtotalCents,
    taxCents,
    feesCents,
    taxReimbursable: values.taxReimbursable,
    feesReimbursable: values.feesReimbursable,
  });

  // A heads-up, not a block — tax on a return or adjustment can genuinely exceed the subtotal
  // it's attached to, so this is worth a second look rather than a hard rejection (C-05).
  const taxExceedsSubtotal = taxCents > 0 && taxCents > subtotalCents;
  // Also a heads-up, not a block (C-07) — a $0.00 expense is unusual but not against any
  // domain rule, and it can be legitimate (a placeholder row filled in later). Checked with
  // the strict parser, not the OrZero fallback used above: OrZero can't tell "typed 0" apart
  // from "typed garbage", and garbage is a different, more actionable problem than a genuine
  // zero — the server's own validation catches garbage on submit, so this message would be
  // actively misleading if it fired for that case too.
  const subtotalIsZero = parseMoneyToCents(values.subtotal) === 0;

  // Budget figures for the month currently selected, which is not necessarily the one the
  // expense is saved in — the Month dropdown moves it (R2.2).
  const remainingForMonth = remainingByMonth?.[values.month] ?? remaining;

  // Plain arithmetic like the amount above, for the same reason: memoising it forced the
  // React compiler to skip optimising the whole component.
  const projection = ((): number | null => {
    if (!values.lineItemId) return null;
    const base = remainingForMonth[values.lineItemId];
    if (base === undefined) return null;
    // The saved amount is only inside this line item's remaining figure when the expense
    // has not been moved to a different line item.
    const sameLineItem = existing?.values.lineItemId === values.lineItemId;
    return projectedRemainingCents({
      remainingCents: base,
      formReimbursableCents: reimbursableCents,
      // Credit the saved amount back only when it is actually inside this month's figure.
      // `remaining(M)` counts every month up to and including M, so an expense saved in an
      // earlier month is in there and would be double-counted; one saved in a LATER month is
      // not, and crediting it back would invent budget that does not exist.
      editingExistingCents:
        sameLineItem &&
        existing &&
        compareMonthKeys(existing.values.month, values.month) <= 0
          ? existing.savedReimbursableCents
          : 0,
    });
  })();

  // Exactly what the cover sheet will print, from the same domain rule that prints it —
  // so the form cannot promise a disclosure the document does not carry (R6.5a).
  const autoNote = exclusionNote(
    excludedParts({
      subtotalCents,
      taxCents,
      feesCents,
      taxReimbursable: values.taxReimbursable,
      feesReimbursable: values.feesReimbursable,
    }),
  );

  const lineItemName =
    sourceLineItems.find((item) => item.id === values.lineItemId)?.name ?? "";

  // Warn about the month/source the expense is heading for, not the one it came from: moving
  // into a submitted month is the case that actually changes a packet someone already
  // received. Checked for the target source first, then (on edit, if the source is also
  // changing) the OLD source too — moving can leave either one submitted.
  const selectedMonthSubmittedOn =
    submittedOn?.[`${values.fundingSourceId}:${values.month}`] ??
    (existing ? submittedOn?.[`${existing.values.fundingSourceId}:${values.month}`] : undefined) ??
    (values.month === existing?.values.month
      ? existing?.monthSubmittedOn
      : null);

  // Locked months (Appendix A §2, D-96): `ownSavedLocked` is this record's own *committed*
  // source/month — reached by opening its Edit page directly, not by anything the dropdowns
  // below can change — and disables the whole form. `selectedMonthLocked` follows the
  // dropdowns live, the same way `selectedMonthSubmittedOn` does, and is what the Month
  // choice picks up when adding a new expense or moving an existing one.
  const lockedMonthKeys = new Set(lockedMonths);
  const ownSavedLocked = existing
    ? lockedMonthKeys.has(`${existing.values.fundingSourceId}:${existing.values.month}`)
    : false;
  const selectedMonthLocked = lockedMonthKeys.has(`${values.fundingSourceId}:${values.month}`);

  // "Read amounts from documents" (Appendix A §3): hidden when there's nothing to read, or the
  // record is locked — a locked expense's own fieldset already blocks every other control.
  const showReadAmountsButton =
    editing && readAmounts && !ownSavedLocked && readableFiles.length > 0;

  // Vendor autofill (R8.1): an exact match fills line item and description; partials list.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const term = values.name.trim();
    const loadedName = existing?.values.name.trim();
    if (searchTimer.current) clearTimeout(searchTimer.current);

    // All state changes happen inside the debounce callback, never synchronously in the
    // effect body, so typing never triggers a render cascade.
    searchTimer.current = setTimeout(async () => {
      // Read and cleared here, once: a name typed over it within the delay no longer matches.
      const fromReceipt = nameFromReceipt.current === term;
      nameFromReceipt.current = null;
      // In edit mode the name is prefilled; searching it would pop an unrequested dropdown
      // over the fields below a moment after the page loads.
      if (term.length < 2 || term === loadedName) {
        setSuggestions([]);
        return;
      }
      const result = await searchVendorsAction(term);
      if (!result.ok) {
        // Autofill is a convenience, so a lookup failure must not interrupt typing — but an
        // expired session would otherwise be invisible until the save is rejected.
        if (result.error === SESSION_EXPIRED) toast.error(result.error);
        return;
      }
      const exact = result.data.find(
        (row) => row.name.toLowerCase() === term.toLowerCase(),
      );
      if (exact && exact.lineItemId) {
        // Typing a name is not the same as choosing a vendor: this fires on its own, from
        // characters the user was typing anyway, so it may only fill blanks. Clicking a
        // suggestion is deliberate and does overwrite — see `pickSuggestion`.
        setValues((current) =>
          fillFromTypedName(
            current,
            exact,
            options.paymentSources,
            (options.lineItemsBySource[current.fundingSourceId] ?? []).map((item) => item.id),
            { amounts: !fromReceipt },
          ),
        );
        setAutofilled(true);
        setTimeout(() => setAutofilled(false), 1400);
        setSuggestions([]);
      } else if (fromReceipt) {
        // The receipt's vendor was chosen on purpose: no list of other remembered names drops
        // open over the top of the form, away from the box the Add was pressed in.
        setSuggestions([]);
      } else {
        setSuggestions(
          result.data.filter(
            (row) => row.name.toLowerCase() !== term.toLowerCase(),
          ),
        );
      }
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
    // Only stable props and the typed name: the line item ids are read from the updater's own
    // `current`, so nothing rebuilt per render may appear here (see `lineItemIdsFor`).
  }, [values.name, existing, options.paymentSources, options.lineItemsBySource]);

  /**
   * Apply a vendor the user actually clicked.
   *
   * Clicking is an explicit choice, so it replaces what is already in the fields rather than
   * quietly declining to — the previous behaviour filled blanks only, which meant picking a
   * line item first and then choosing a vendor appeared to do nothing at all.
   *
   * The subtotal is the exception: it is offered as a starting point, and the amount is the
   * one field that is genuinely new each time, so a figure already typed is never replaced
   * by a remembered one.
   */
  function pickSuggestion(row: VendorFill) {
    setValues((current) =>
      fillFromClick(
        current,
        row,
        options.paymentSources,
        lineItemIdsFor(current.fundingSourceId),
      ),
    );
    setSuggestions([]);
    setAutofilled(true);
    setTimeout(() => setAutofilled(false), 1400);
  }

  /**
   * What to say after a successful save.
   *
   * A record the gate will hold at month end (no proof of payment, no receipt, or both) is
   * cheapest to fix the moment it is captured, so the toast names every gap (m02, #30).
   */
  function savedMessage(): string {
    return savedMessageFor({
      noReceipt: values.noReceipt,
      attached: existing?.documents ?? [],
      queued,
      invoiceIsReceipt: invoiceReceipt !== undefined && !values.noReceipt,
    });
  }

  /** `owner` is the expense these files belong to, or the draft when the form is editing one:
   *  a draft has no `expense_documents` row, so its files live in their own table until it is
   *  approved (Phase 14). */
  async function uploadQueued(ownerId: string, owner: "expense" | "draft" = "expense"): Promise<string | null> {
    for (const [index, item] of queued.entries()) {
      setStatus(`Uploading ${index + 1} of ${queued.length}…`);
      const form = new FormData();
      form.set("target", owner);
      form.set(owner === "draft" ? "draftId" : "expenseId", ownerId);
      form.set("scope", item.scope);
      if (item.supportingType) form.set("supportingType", item.supportingType);
      form.set("file", item.file);

      try {
        let response = await fetch("/api/files/upload", {
          method: "POST",
          body: form,
        });

        // A rate-limited upload is a "wait", not a "no": a long queue is exactly what F1
        // exists to allow, and losing its tail because the window filled would undo that.
        // One patient retry, then treat it as a real failure (D-73).
        if (response.status === 429) {
          setStatus(
            `Uploading ${index + 1} of ${queued.length}. Waiting a few seconds…`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, RATE_LIMIT_RETRY_MS),
          );
          response = await fetch("/api/files/upload", {
            method: "POST",
            body: form,
          });
        }

        const result = (await response.json()) as {
          ok: boolean;
          error?: string;
        };
        if (!result.ok) {
          // Keep the files that have not been tried yet, so nothing disappears silently.
          setQueued(queued.slice(index));
          return `${item.file.name}: ${result.error ?? UI.uploadFailed}`;
        }
      } catch {
        setQueued(queued.slice(index));
        return `${item.file.name}: ${UI.uploadFailed}`;
      }
    }
    setQueued([]);
    return null;
  }

  /**
   * If the header is showing one specific source and the expense was just saved under a
   * *different* one, follow it there before landing on the list — otherwise the header kept
   * pointing at the old source, the list filtered to it, and a just-saved expense looked like
   * it had never been saved at all (review fix). Left alone when the header is on "All": the
   * list already shows every source, so nothing there would hide the new expense.
   */
  async function switchHeaderSourceIfNeeded() {
    if (headerSelectedSourceId !== null && headerSelectedSourceId !== values.fundingSourceId) {
      await setActiveFundingSourceAction(values.fundingSourceId);
    }
  }

  /** Whichever table this form's files live in — the draft one when the draft edit page
   *  passed it, `expense_documents` otherwise. Resolved once so the three remove
   *  controls cannot drift apart. */
  const removeDocument = removeDocumentAction ?? removeExpenseDocumentAction;

  /** Where a draft edit returns to: the month's drafts list, which is the one containing the
   *  row that was just saved. Built once so Save and Cancel cannot drift apart. */
  const draftListHref = `/r/expenses?month=${values.month}&view=drafts`;

  /**
   * Field ids, unique per mounted form.
   *
   * The invoice check screen mounts one of these per charge, so a fixed `id="narrative"`
   * appeared a dozen times on one page: clicking the fourth card's Narrative label moved the
   * cursor into the FIRST card's box, and every `aria-labelledby` pointed at the first card's
   * label too, so a screen reader read the wrong field name on all but one.
   */
  const uid = useId();
  const fieldId = useCallback((field: string) => `${field}-${uid}`, [uid]);
  const errorId = (field: keyof ExpenseInput) => fieldId(`${field}-error`);
  /** Wires a control to its error for screen readers (#24). */
  const invalid = (field: keyof ExpenseInput) =>
    fieldErrors[field] ? { "aria-invalid": true as const, "aria-describedby": errorId(field) } : {};
  const errorFor = (field: keyof ExpenseInput) =>
    fieldErrors[field] ? <FieldError id={errorId(field)}>{fieldErrors[field]}</FieldError> : null;

  /** A refusal either names fields (each shown under its own field, #24) or is one message. */
  function showFailure(result: { error: string; fieldErrors?: FieldErrors }) {
    if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
      focusFirstError.current = true;
      setFieldErrors(result.fieldErrors);
    } else {
      setError(result.error);
    }
  }

  // After a receipt's Add has re-rendered the box: focus the Add that is left, or, when the box
  // has gone, the field just filled. That field sits at the top of the form, so the page only
  // scrolls to it for a keyboard press; a mouse user keeps their place by the amounts.
  useEffect(() => {
    const pending = refocusAfterAdd.current;
    if (!pending) return;
    refocusAfterAdd.current = null;
    const nextAdd = receiptBoxRef.current?.querySelector("button");
    if (nextAdd) nextAdd.focus();
    else document.getElementById(fieldId(pending.field))?.focus({ preventScroll: !pending.fromKeyboard });
  });

  /**
   * What this charge would still be refused for, by the same rule the drafts list shows in its
   * "Still needs" column — read off the live fields, not the stored row, so it answers for
   * what the person has just typed rather than for the draft as it arrived.
   *
   * Used only to explain a refusal, never to hide the button: the server decides.
   */
  const stillNeeds = () =>
    draftNeeds({
      lineItemId: values.lineItemId || null,
      narrative: values.narrative,
      name: values.name,
      paymentSource: values.paymentSource,
      date: values.date,
    });

  /**
   * Save this draft and approve it in one press.
   *
   * Two actions rather than one, deliberately: the save has to land first, or approval would
   * check readiness against the row as it was before the edit and refuse a draft the person
   * has just finished. `approveDraftAction` re-checks everything server side anyway, so a
   * draft that is still short of something is refused there and the message says what.
   */
  function saveAndApprove() {
    setError(null);
    setFieldErrors({});
    setStatus(null);
    if (selectedMonthLocked) {
      setError(UI.monthLocked(monthLabel(values.month)));
      return;
    }
    startTransition(async () => {
      const saved = await saveAction!({ ...values, id: existing!.id });
      if (!saved.ok) {
        showFailure(saved);
        return;
      }
      const uploadError = await uploadQueued(existing!.id, "draft");
      if (uploadError) {
        setStatus(null);
        setError(uploadError);
        router.refresh();
        return;
      }
      const approved = await approveAction!(existing!.id);
      if (!approved.ok) {
        // Saved, but not approved: say so rather than leaving it looking like nothing worked.
        // And name the fields when they are what is wrong. The server's own refusal says "Open
        // it and fill in what it needs", which is the drafts LIST speaking — read on this
        // screen, where the draft is already open, it tells the person to do what they are
        // doing. Every other refusal (locked month, archived source, draft gone) is passed
        // through untouched, because only this one knows less than the screen does.
        const needs = stillNeeds();
        setError(needs.length > 0 ? UI.draftSavedNotApproved(needs) : approved.error);
        router.refresh();
        return;
      }
      toast.success(UI.draftApprovedOne);
      await switchHeaderSourceIfNeeded();
      router.push(`/r/expenses?month=${values.month}`);
      router.refresh();
    });
  }

  function save() {
    setError(null);
    setFieldErrors({});
    setStatus(null);
    // Refused client-side too, matching what the server would say — a courtesy, not the
    // guarantee: the server checks again inside the same transaction as the write itself
    // (Appendix A "the block must still hold if someone had a page open").
    if (selectedMonthLocked) {
      setError(UI.monthLocked(monthLabel(values.month)));
      return;
    }
    startTransition(async () => {
      if (saveAction) {
        const result = await saveAction({ ...values, id: existing!.id });
        if (!result.ok) {
          showFailure(result);
          return;
        }
        // The draft owns these files until it is approved, so they go to its own table
        // (`expense_draft_documents`, migration 0033) and are re-pointed at the expense by
        // `approveDraftAction`. Uploaded after the save, like every other path, because the
        // row has to exist before anything can hang off it.
        const uploadError = await uploadQueued(existing!.id, "draft");
        if (uploadError) {
          setStatus(null);
          setError(uploadError);
          router.refresh();
          return;
        }
        // Not `savedMessage()`: that one nags about missing documents, which a draft
        // is not blocked by (ticket §5) — a draft is in no gate and no packet until it is
        // approved. No `UI.draft*` string covers this line, so it reads plainly here.
        toast.success("Draft saved.");
        await switchHeaderSourceIfNeeded();
        // Back to the DRAFTS list, not the expenses table: the row just saved is a draft, and
        // landing on the list that does not contain it reads as a save that failed (invariant
        // F). On a twelve-line invoice that is twelve wrong landings and twelve trips back.
        router.push(draftListHref);
        router.refresh();
        return;
      }

      if (editing) {
        const result = await updateExpenseAction({
          ...values,
          id: existing!.id,
        });
        if (!result.ok) {
          showFailure(result);
          return;
        }
        // A real expense owns its files directly — `expense_documents`, the default owner.
        // (Review fix: this branch used to pass "draft", which sent an expense id to the
        // draft ingest path and failed every attachment with "That draft no longer exists.")
        const uploadError = await uploadQueued(existing!.id);
        if (uploadError) {
          setStatus(null);
          setError(uploadError);
          router.refresh();
          return;
        }
        toast.success(savedMessage());
        // The expense's own month, not wherever the org's shared active month happens to be
        // (R2.2 lets them differ) — otherwise landing on the active month's list after saving
        // into a different one made the just-saved record look like it had vanished.
        await switchHeaderSourceIfNeeded();
        router.push(`/r/expenses?month=${values.month}`);
        router.refresh();
        return;
      }

      if (embedded) {
        const created = await embedded.save.action(values);
        if (!created.ok) {
          showFailure(created);
          return;
        }
        // No upload here, exactly like the draft branch below. Marking a charge card writes
        // nothing: `saveCard` hands back the CARD's own id, not an expense id, and the whole
        // invoice is written by one request when Done is pressed. Posting the queued files
        // against that card id asked the server for an expense that does not exist yet, so a
        // card with a file attached always answered "That expense no longer exists. The
        // expense was saved. Add the file again below." — three statements, two of them untrue.
        // The files are already mirrored to the card by `onQueuedChange` and travel with Done.
        setStatus(null);
        toast.success(savedMessage());
        embedded.onSaved("expense");
        return;
      }

      const created = await createExpenseAction(values);
      if (!created.ok) {
        showFailure(created);
        return;
      }
      const uploadError = await uploadQueued(created.data.id);
      setStatus(null);
      if (uploadError) {
        // The expense exists; the file did not attach. Send the user to the record so
        // they can retry rather than losing what they entered. A toast, not the form's error:
        // this form unmounts on the way to Edit, and the message went with it (PHASE-13 review).
        toast.error(`${uploadError} The expense was saved. Add the file again below.`);
        router.push(`/r/expenses/${created.data.id}/edit`);
        router.refresh();
        return;
      }
      toast.success(savedMessage());
      await switchHeaderSourceIfNeeded();
      router.push(`/r/expenses?month=${values.month}`);
      router.refresh();
    });
  }

  /** The draft button beside Save, present only when `embedded`. Same locked-month guard as
   *  `save()`, but posts through `embedded.draft.action` and skips uploads entirely — a draft
   *  has no `expense_documents` row to attach anything to. */
  function saveDraft() {
    if (!embedded) return;
    setError(null);
    setFieldErrors({});
    setStatus(null);
    if (selectedMonthLocked) {
      setError(UI.monthLocked(monthLabel(values.month)));
      return;
    }
    startTransition(async () => {
      const result = await embedded.draft.action(values);
      if (!result.ok) {
        showFailure(result);
        return;
      }
      toast.success("Draft saved.");
      embedded.onSaved("draft");
    });
  }

  const highlight = autofilled ? "bg-autofill" : "bg-surface";

  // Proof of payment + Receipt, defined once: Plus renders them above the amounts, everyone
  // else below (Phase 10) — one definition so the two orders can never drift apart.
  //
  // Shown everywhere now. A draft's files go to `expense_draft_documents` and approval
  // re-points them at the new expense; an invoice card's are held in the browser and travel
  // with the one request that creates everything. Both have somewhere to live, which is what
  // PHASE-14.md §2.1 C5 originally said they did not.
  const proofAndReceipt = (
    <>
      <div data-tour="add-expense-proof">
        <UploadField
          label="Proof of payment"
          scope="proof"
          ai={uploadAi}
          queued={queued}
          setQueued={setQueued}
          attached={
            existing?.documents.filter((doc) => doc.kind === "proof") ?? []
          }
          disabled={pending || ownSavedLocked}
          onRemoveAttached={(id) =>
            startTransition(async () => {
              if (
                reportResult(
                  await removeDocument(id),
                  "File removed.",
                )
              ) {
                router.refresh();
              }
            })
          }
        />
      </div>

      <div className="border-t border-line pt-[22px]" data-tour="add-expense-receipt">
        <UploadField
          label="Receipt / justification (receipt, invoice, or timesheet)"
          scope="receipt"
          ai={uploadAi}
          queued={queued}
          setQueued={setQueued}
          attached={
            existing?.documents.filter((doc) => doc.kind === "receipt") ??
            []
          }
          disabled={pending || values.noReceipt || ownSavedLocked}
          hidden={values.noReceipt}
          onRemoveAttached={(id) =>
            startTransition(async () => {
              if (
                reportResult(
                  await removeDocument(id),
                  "File removed.",
                )
              ) {
                router.refresh();
              }
            })
          }
        />

        {/* Under the receipt tile, where the files for this expense are listed: the invoice is
            one of them, it is simply owned by the import until the charge is created. */}
        {invoiceReceipt && !values.noReceipt && (
          <InvoiceReceiptChip
            filename={invoiceReceipt.filename}
            href={invoiceReceipt.href}
            file={invoiceReceipt.file}
          />
        )}

        <label className="flex items-center gap-2.5 mt-3.5 text-base cursor-pointer min-h-11">
          <input
            type="checkbox"
            checked={values.noReceipt}
            disabled={ownSavedLocked}
            onChange={(event) => {
              const checked = event.target.checked;
              // Ask before the files disappear from view, not on the way out of the form.
              if (checked && attachedReceipts.length > 0) {
                setConfirmingNoReceipt(true);
                return;
              }
              applyNoReceipt(checked);
            }}
            className="w-5 h-5 accent-accent"
          />
          <span>No receipt available</span>
        </label>

        {values.noReceipt && (
          <div className="mt-2">
            <Label htmlFor={fieldId("noReceiptReason")}>
              Reason (prints on the cover sheet){" "}
              <span className="text-danger">Required</span>
            </Label>
            <Textarea
              id={fieldId("noReceiptReason")}
              disabled={ownSavedLocked}
              rows={2}
              value={values.noReceiptReason}
              onChange={(event) =>
                set("noReceiptReason", event.target.value)
              }
              {...invalid("noReceiptReason")}
            />
            {errorFor("noReceiptReason")}
            {attachedReceipts.length > 0 && (
              <Helper className="text-danger">
                Saving with this checked removes the{" "}
                {attachedReceipts.length} receipt file
                {attachedReceipts.length === 1 ? "" : "s"} already attached.
              </Helper>
            )}
          </div>
        )}
      </div>
    </>
  );

  // 560px standalone was a narrow column with most of a desktop empty beside it. The paired
  // fields below need roughly twice that; the cap stays so the form never becomes a
  // full-bleed row of very wide inputs, which is its own readability problem.
  //
  // An invoice card keeps the narrow column: it renders several of these stacked inside a
  // 720px check screen, where a second column has nowhere to go.
  return (
    <div className={embedded ? undefined : "max-w-[560px] lg:max-w-[940px]"}>
      {ownSavedLocked && existing && (
        <DangerPanel className="mb-5">
          {UI.monthLocked(monthLabel(existing.values.month))}
        </DangerPanel>
      )}

      {!ownSavedLocked &&
        (selectedMonthLocked ? (
          <DangerPanel className="mb-5">{UI.monthLocked(monthLabel(values.month))}</DangerPanel>
        ) : (
          selectedMonthSubmittedOn && (
            <DangerPanel tone="notice" className="mb-5">
              {monthLabel(values.month)} was submitted on {selectedMonthSubmittedOn}. Your
              changes won&apos;t alter the packet already downloaded, but documents downloaded
              from now on will include them.
            </DangerPanel>
          )
        ))}

      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave(queued, pending)) save();
        }}
      >
        {/*
          A panel of its own only when this form IS the screen. Inside an invoice charge card
          the card already draws the border and the padding, so a `Card` here put a second
          rounded box inside the first — the extra divider down the middle of the charge.

          The classes are spelled out rather than layering overrides onto `Card`: `cn` joins
          without merging, so a `border-0` beside its `border` would leave both in the class
          list and let stylesheet order decide which won.
        */}
        <div
          className={cn(
            "flex flex-col gap-[22px]",
            !embedded && "bg-surface border border-line rounded-[10px] p-7",
          )}
        >
          {/* `display: contents` keeps the panel's own flex layout unchanged — the fieldset
              contributes only its native disabling, in one attribute, of every input, select,
              textarea and button inside it (plan §3.11). */}
          <fieldset disabled={ownSavedLocked} className="contents">
          {/* The only fields that gain from pairing: short, single-line, and read together.
              One grid wrapper rather than making the whole card a grid and then spanning the
              dozen children that must stay full width. */}
          <div className="grid gap-x-6 gap-y-[22px] lg:grid-cols-2">
          <div className="relative" data-tour="add-expense-name">
            <Label htmlFor={fieldId("name")}>Name</Label>
            <Input
              id={fieldId("name")}
              className={receiptFilled === "name" ? "bg-autofill!" : undefined}
              value={values.name}
              autoComplete="off"
              onChange={(event) => set("name", event.target.value)}
              placeholder="Vendor, person, or a short label"
              {...invalid("name")}
            />
            {errorFor("name")}
            {suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-line rounded-[3px] z-10 max-h-[220px] overflow-y-auto">
                {suggestions.map((row) => {
                  // What clicking will actually put in the form. Shown because the name alone
                  // does not say whether picking this vendor is what you want — searched
                  // against the current source's list, since autofill never crosses sources.
                  const vendorLineItem = sourceLineItems.find(
                    (item) => item.id === row.lineItemId,
                  )?.name;
                  // Only mention a source that could actually be applied (R5.2).
                  const usableSource =
                    row.paymentSource &&
                    options.paymentSources.includes(row.paymentSource)
                      ? row.paymentSource
                      : null;
                  const detail = [vendorLineItem, usableSource, row.description]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <button
                      key={row.name}
                      type="button"
                      onClick={() => pickSuggestion(row)}
                      className="block w-full text-left px-3.5 py-2.5 border-b border-line last:border-b-0 hover:bg-section min-h-11"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="text-base flex-1 min-w-0 truncate">
                          {row.name}
                        </span>
                        {row.subtotalCents !== null && (
                          <span className="text-sm text-sub tabular-nums flex-none">
                            last {formatMoney(row.subtotalCents)}
                          </span>
                        )}
                      </span>
                      {detail && (
                        <span className="block text-sm text-sub truncate">
                          {detail}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {!embedded && (
          <div>
            <Label htmlFor={fieldId("fundingSource")}>Funding source</Label>
            {options.fundingSources.length === 1 ? (
              // One source: pre-filled and not editable, no extra clicks (spec §2/§4).
              <div id={fieldId("fundingSource")} className="text-base py-1.5">
                {options.fundingSources[0].name}
              </div>
            ) : (
              <Select
                id={fieldId("fundingSource")}
                {...invalid("fundingSourceId")}
                value={values.fundingSourceId}
                onValueChange={(value) => {
                  const nextSource = options.fundingSources.find((s) => s.id === value);
                  setError(null);
                  // Changing the source clears the line item (it belongs to the old source's
                  // list) and re-applies the new source's tax/fee rules — one update (spec §4).
                  setValues((current) => ({
                    ...current,
                    fundingSourceId: value,
                    lineItemId: "",
                    ...(nextSource
                      ? {
                          taxReimbursable: nextSource.taxReimbursable,
                          feesReimbursable: nextSource.feesReimbursable,
                        }
                      : {}),
                  }));
                }}
              >
                {options.fundingSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </Select>
            )}
            {errorFor("fundingSourceId")}
          </div>
          )}

          <div>
            <Label id={fieldId("lineItem-label")} htmlFor={fieldId("lineItem")}>
              Line item
            </Label>
            <Select
              id={fieldId("lineItem")}
              aria-labelledby={fieldId("lineItem-label")}
              {...invalid("lineItemId")}
              value={values.lineItemId}
              className={highlight}
              onValueChange={(value) => set("lineItemId", value)}
            >
              <option value="">Choose a line item</option>
              {sourceLineItems.map((item) => {
                const r = remainingForMonth[item.id];
                return (
                  <option key={item.id} value={item.id}>
                    {r === undefined ? item.name : `${item.name} · ${formatMoney(r)} remaining`}
                  </option>
                );
              })}
            </Select>
            {errorFor("lineItemId")}
          </div>

          <div>
            <Label id={fieldId("paymentSource-label")} htmlFor={fieldId("paymentSource")}>
              Payment source
            </Label>
            <Select
              id={fieldId("paymentSource")}
              aria-labelledby={fieldId("paymentSource-label")}
              {...invalid("paymentSource")}
              value={values.paymentSource}
              onValueChange={(value) => set("paymentSource", value)}
            >
              <option value="">Choose a payment source</option>
              {/*
              An expense keeps the label it was saved with even after that label is retired
              (R5.2). Without offering it here the control would render blank on every
              historical expense, and saving would silently rewrite a snapshot that has
              already printed on a submitted cover sheet.
            */}
              {selectablePaymentSources.map((label) => (
                <option key={label} value={label}>
                  {label}
                  {options.paymentSources.includes(label) ? "" : " (no longer in use)"}
                </option>
              ))}
            </Select>
            {errorFor("paymentSource")}
          </div>

          {/*
            Spans both columns only when it actually holds both fields. An invoice card fixes
            the month from the invoice and hides that field, leaving Date alone in a row still
            claiming the full width — so Date stretched across the card while Payment source
            sat beside an empty cell. As an ordinary cell there, Date simply pairs with it.
          */}
          <div className={cn("flex flex-wrap gap-[18px]", !embedded && "lg:col-span-2")}>
            {!embedded && (
            <div className="flex-1 min-w-[220px]">
              <Label id={fieldId("month-label")} htmlFor={fieldId("month")}>
                Reporting month
              </Label>
              <Select
                id={fieldId("month")}
                aria-labelledby={fieldId("month-label")}
                {...invalid("month")}
                value={values.month}
                onValueChange={(value) => {
                  set("month", value);
                  // A refusal (a locked month, say) was about the previous choice.
                  setError(null);
                }}
              >
                {options.months.map((month) => (
                  <option key={month} value={month}>
                    {monthLabel(month)}
                  </option>
                ))}
              </Select>
              {errorFor("month")}
              <Helper>The month whose packet this expense goes in. It can differ from the date.</Helper>
            </div>
            )}
            <div className="flex-1 min-w-[220px]">
              <Label htmlFor={fieldId("date")}>Date</Label>
              <Input
                id={fieldId("date")}
                className={receiptFilled === "date" ? "bg-autofill!" : undefined}
                type="date"
                value={values.date}
                onChange={(event) => set("date", event.target.value)}
                {...invalid("date")}
              />
              {errorFor("date")}
            </div>
          </div>
          </div>

          <div data-tour="add-expense-description">
            <Label htmlFor={fieldId("description")}>Description / role</Label>
            <Textarea
              id={fieldId("description")}
              rows={2}
              className={highlight}
              value={values.description}
              onChange={(event) => set("description", event.target.value)}
            />
            <Helper>
              Prints in the cover sheet table next to the name, exactly as typed. For a salary, the
              person&apos;s role.
            </Helper>
          </div>

          {/* The fieldset pauses here for the upload fields. A disabled fieldset disables
              every button inside it, and a file’s preview is a button: on a locked month that
              would have stopped anyone opening the receipts, and the lock must leave everything
              viewable (R10.7). `UploadField`’s own `disabled` blocks adding and removing while
              leaving preview alone, so these take that instead. */}
          </fieldset>

          {/* Plus (Phase 10): files first, so the amounts sit right under the documents they are
              read from. Without reading the form keeps its original order (Appendix A §4). */}
          {readAmounts && proofAndReceipt}

          <fieldset disabled={ownSavedLocked} className="contents">
          <div
            className={cn("flex flex-wrap gap-3.5", readAmounts && "border-t border-line pt-[22px]")}
            data-tour="add-expense-amounts"
          >
            {(["subtotal", "tax", "fees"] as const).map((field) => (
              <div key={field} className="flex-1 min-w-[150px]">
                <Label htmlFor={fieldId(field)} className="capitalize">
                  {field}
                </Label>
                <MoneyInput
                  id={fieldId(field)}
                  value={values[field]}
                  placeholder="0.00"
                  onChange={(event) => set(field, event.target.value)}
                  {...invalid(field)}
                />
                {errorFor(field)}
              </div>
            ))}
          </div>

          {showReadAmountsButton && (
            <div>
              <Button
                variant="secondary"
                onClick={() => {
                  setRequested(true);
                  setDismissedFor(null);
                }}
              >
                {UI.readAmountsFromDocuments}
              </Button>
            </div>
          )}

          <ReceiptDetailsSuggestion
            containerRef={receiptBoxRef}
            vendor={vendorToOffer}
            date={dateToOffer ? formatDateUS(dateToOffer) : null}
            onAddVendor={(fromKeyboard, at) => vendorToOffer && addReceiptVendor(vendorToOffer, fromKeyboard, at)}
            onAddDate={(fromKeyboard, at) => dateToOffer && addReceiptDate(dateToOffer, fromKeyboard, at)}
          />

          {showAmountSuggestionPanel && (
            <AmountSuggestionPanel
              suggestion={suggestion}
              applied={amountsMatchSuggestion(values, suggestion)}
              onUse={useSuggestedAmounts}
              onDismiss={() => setDismissedFor(amountReadSignature)}
            />
          )}

          {(taxCents !== 0 || feesCents !== 0) && (
            <div className="border border-line rounded-[3px] bg-section px-4 py-3.5">
              <div className="text-[15px] font-semibold text-ink mb-2.5">
                Include in reimbursement
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2.5">
                {(
                  [
                    ["taxReimbursable", "Tax", taxCents],
                    ["feesReimbursable", "Fees", feesCents],
                  ] as const
                ).map(([field, label, cents]) => (
                  <label
                    key={field}
                    className={cn(
                      "flex items-center gap-2.5 text-base",
                      cents === 0
                        ? "text-disabled-ink"
                        : "text-ink cursor-pointer",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="w-[18px] h-[18px] accent-accent"
                      checked={values[field]}
                      disabled={cents === 0}
                      onChange={(event) => set(field, event.target.checked)}
                    />
                    {label} ({formatMoney(cents)})
                  </label>
                ))}
              </div>
              <Helper className="mt-2.5">
                Funders differ on what they reimburse. Whatever is left out
                stays on the receipt and is disclosed on the cover sheet.
              </Helper>
            </div>
          )}

          {subtotalIsZero && (
            <div className="text-[15px] text-caution">
              {UI.subtotalIsZeroWarning}
            </div>
          )}

          {taxExceedsSubtotal && (
            <div className="text-[15px] text-caution">
              {UI.taxExceedsSubtotalWarning}
            </div>
          )}

          <div
            className="border-2 border-ink rounded-[3px] bg-surface px-[22px] py-5"
            data-tour="add-expense-reimbursable"
          >
            <div className="text-2xl font-bold tabular-nums">
              Reimbursable amount: {formatMoney(reimbursableCents)}
            </div>
            <div className="text-[15px] text-sub mt-2 leading-relaxed tabular-nums">
              Receipt total: {formatMoney(receiptTotal)}
              {receiptTotal !== reimbursableCents && (
                <>
                  {" "}
                  ({formatMoney(receiptTotal - reimbursableCents)} not reimbursed)
                </>
              )}
            </div>
          </div>

          {projection !== null && (
            <div
              className={
                projection < 0
                  ? "text-[15px] font-bold text-danger tabular-nums"
                  : "text-[15px] text-sub tabular-nums"
              }
            >
              Remaining on {lineItemName} after this expense:{" "}
              {formatMoney(projection)}
            </div>
          )}
          </fieldset>

          {!readAmounts && proofAndReceipt}

          {(
            <div className="border-t border-line pt-[22px]">
              <UploadField
                label="Supporting documents"
                scope="supporting"
                queued={queued}
                setQueued={setQueued}
                attached={
                  existing?.documents.filter(
                    (doc) => doc.kind === "supporting",
                  ) ?? []
                }
                disabled={pending || ownSavedLocked}
                supportingTypes={options.supportingDocTypes}
                onRemoveAttached={(id) =>
                  startTransition(async () => {
                    if (
                      reportResult(
                        await removeDocument(id),
                        "File removed.",
                      )
                    ) {
                      router.refresh();
                    }
                  })
                }
              />
            </div>
          )}

          <fieldset disabled={ownSavedLocked} className="contents">
          <div className="border-t border-line pt-[22px]">
            <Label htmlFor={fieldId("note")}>
              Note <span className="font-normal text-sub">(optional)</span>
            </Label>
            <Input
              id={fieldId("note")}
              value={values.note}
              onChange={(event) => set("note", event.target.value)}
            />
            <Helper>
              {/* Says where it prints (R6.5), and names the automatic disclosure only when one will
                actually print beside it (R6.5a), since tax can be reimbursable. */}
              {autoNote
                ? `A short extra remark, highlighted next to this expense on the cover sheet. The automatic note prints too: ${autoNote}`
                : "A short extra remark, highlighted next to this expense on the cover sheet."}
            </Helper>
          </div>

          <div>
            <Label htmlFor={fieldId("narrative")}>
              Narrative <span className="font-normal text-sub">(required)</span>
            </Label>
            <Textarea
              id={fieldId("narrative")}
              rows={3}
              value={values.narrative}
              onChange={(event) => set("narrative", event.target.value)}
              {...invalid("narrative")}
            />
            {errorFor("narrative")}
            <Helper>
              A sentence or two on what this was for. Prints as a paragraph under this expense on the
              cover sheet.
            </Helper>
          </div>

          </fieldset>

          {error && <DangerPanel>{error}</DangerPanel>}
          {!error && Object.keys(fieldErrors).length > 0 && (
            <DangerPanel>{UI.checkHighlightedFields}</DangerPanel>
          )}
          {status && <div className="text-[15px] text-sub">{status}</div>}

          <div className="flex flex-wrap items-center gap-5">
            {!ownSavedLocked && (
              <Button type="submit" disabled={!canSave(queued, pending)}>
                {pending
                  ? "Saving…"
                  : converting
                    ? UI.convertingPhotos
                    : embedded
                      ? embedded.save.label
                      : editing
                        ? "Save changes"
                        : "Save expense"}
              </Button>
            )}
            {embedded && (
              <Button type="button" variant="secondary" disabled={pending} onClick={saveDraft}>
                {embedded.draft.label}
              </Button>
            )}
            {/* Always beside Save, never conditional on readiness. It used to be gated on the
                stored row, on the server, at render — so the button was missing from exactly
                the drafts someone opens this screen to finish, and appeared only after saving,
                leaving and coming back. Two buttons that are always both there is one less
                thing to work out: press either, and a refusal says what is still needed. */}
            {approveAction && (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={saveAndApprove}
              >
                {UI.draftSaveAndApprove}
              </Button>
            )}
            {!embedded && (
              <Button
                variant="quiet"
                // Same destination as a save, and it keeps the month: a bare "/r/expenses"
                // dropped the month too, so cancelling out of a draft in a month other than
                // the active one landed on a different month's list entirely.
                onClick={() => router.push(saveAction ? draftListHref : `/r/expenses?month=${values.month}`)}
                disabled={pending}
              >
                Cancel
              </Button>
            )}
            {/* Hidden in draft mode: `deleteExpenseAction` cannot touch a draft row — Discard on
                the Expenses list is the equivalent. */}
            {editing && !draftMode && (
              <Button
                variant="quiet"
                onClick={() => setConfirmingDelete(true)}
                disabled={pending || ownSavedLocked}
              >
                Delete
              </Button>
            )}
          </div>
          {/* A draft has no `expense_documents` row, so anything queued here would never attach
              (PHASE-14.md §2.1 C5) — said next to the button that actually discards it. */}
          {embedded && queued.length > 0 && <Helper>{UI.invoiceDraftKeepsFiles}</Helper>}

          {/* Both only reachable while editing: a new expense has nothing attached yet. */}
          {editing && (
            <>
              <Dialog
                open={confirmingNoReceipt}
                title="Remove the attached receipts?"
                dismissLabel="Keep them"
                onDismiss={() => setConfirmingNoReceipt(false)}
                confirm={{
                  label: "Mark as no receipt",
                  onConfirm: () => {
                    setConfirmingNoReceipt(false);
                    applyNoReceipt(true);
                  },
                }}
              >
                Saving will delete the {attachedReceipts.length} receipt file
                {attachedReceipts.length === 1 ? "" : "s"} already attached to
                this expense. You would have to upload{" "}
                {attachedReceipts.length === 1 ? "it" : "them"} again.
              </Dialog>

              <Dialog
                open={confirmingDelete}
                title="Move this expense to the trash?"
                dismissLabel="Keep it"
                onDismiss={() => setConfirmingDelete(false)}
                confirm={{
                  label: "Move to trash",
                  disabled: pending,
                  onConfirm: () => {
                    startTransition(async () => {
                      const result = await deleteExpenseAction(existing!.id);
                      // Stays open (Move to trash disabled via `pending`) until the outcome is
                      // known, so the dialog doesn't vanish out from under a failure the general
                      // error banner is about to show — the dialog would otherwise hide that
                      // banner behind its overlay.
                      setConfirmingDelete(false);
                      if (!result.ok) {
                        setError(result.error);
                        return;
                      }
                      router.push("/r/expenses");
                      router.refresh();
                    });
                  },
                }}
              >
                {existing!.documents.length === 0
                  ? "It moves to the trash and can be restored."
                  : `It moves to the trash with its ${existing!.documents.length} attached file${existing!.documents.length === 1 ? "" : "s"} and can be restored.`}
              </Dialog>
            </>
          )}

          {/* Outside the `editing &&` block on purpose — reachable on Add too, unlike the two
              dialogs above which only make sense once there's something to delete. */}
          {suggestion.state === "done" && (
            <Dialog
              open={showAmountSuggestionPanel && confirmingUseFor === amountReadSignature}
              tone="neutral"
              title={UI.replaceTypedAmounts}
              dismissLabel={UI.cancel}
              onDismiss={() => setConfirmingUseFor(null)}
              confirm={{ label: UI.useTheseAmounts, onConfirm: applySuggestedAmounts }}
            >
              {UI.amountsSummary(suggestion)}
            </Dialog>
          )}
        </div>
      </form>
    </div>
  );
}
