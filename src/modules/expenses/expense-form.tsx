"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";
import {
  Helper,
  Input,
  Label,
  MoneyInput,
  Textarea,
} from "@/src/components/ui/field";
import { Select } from "@/src/components/ui/select";
import { Card, DangerPanel } from "@/src/components/ui/surfaces";
import toast from "react-hot-toast";

import { reportResult } from "@/src/components/ui/toast";
import { setActiveFundingSourceAction } from "@/src/modules/auth/actions";
import { projectedRemainingCents } from "@/src/domain/budget-math";
import { compareMonthKeys, monthLabel } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import {
  parseMoneyToCents,
  parseMoneyToCentsOrZero,
  excludedParts,
  receiptTotalCents,
  reimbursableCents as domainReimbursable,
} from "@/src/domain/money";
import { aggregateAmountSuggestion, panelVisible, type ReadableFile } from "@/src/domain/amount-suggestion";
import { exclusionNote, UI } from "@/src/domain/strings";
import { SESSION_EXPIRED } from "@/src/lib/action-result";
import { cn } from "@/src/lib/cn";

import { AmountSuggestionPanel } from "./amount-suggestion-panel";
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
import { UploadField, type PendingUpload } from "./upload-field";

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
}: ExpenseFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const editing = Boolean(existing);

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
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [autofilled, setAutofilled] = useState(false);
  const [suggestions, setSuggestions] = useState<VendorFill[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Ticking "No receipt available" is a destructive act when receipts are already attached:
  // the save deletes every one of them (R4.2). It used to only warn, and the tick immediately
  // hid the list, so the files were out of sight before the warning was read.
  const [confirmingNoReceipt, setConfirmingNoReceipt] = useState(false);

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

  const readEnabled = editing ? readAmounts && requested : readAmounts;
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
        note: editing ? UI.aiUploadNoteEdit : UI.aiUploadNoteAdd,
        statusFor: (key: string) => (readEnabled ? amountReadResults.get(key) : undefined),
      }
    : undefined;

  function applySuggestedAmounts() {
    if (suggestion.state !== "done") return;
    setValues((current) => ({
      ...current,
      subtotal: (suggestion.subtotalCents / 100).toFixed(2),
      tax: (suggestion.taxCents / 100).toFixed(2),
      fees: (suggestion.feesCents / 100).toFixed(2),
    }));
    setDismissedFor(amountReadSignature);
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
    <K extends keyof ExpenseInput>(key: K, value: ExpenseInput[K]) =>
      setValues((current) => ({ ...current, [key]: value })),
    [],
  );

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
          ),
        );
        setAutofilled(true);
        setTimeout(() => setAutofilled(false), 1400);
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
   * A record with no proof of payment will be held by the gate at month end, so the moment
   * it is captured is when saying so is cheapest to act on (m02).
   */
  function savedMessage(): string {
    const hasProof =
      queued.some((item) => item.scope === "proof") ||
      (existing?.documents ?? []).some(
        (document) =>
          document.kind === "proof" && document.status === "attached",
      );
    return hasProof ? "Expense saved." : UI.savedMissingProof;
  }

  async function uploadQueued(expenseId: string): Promise<string | null> {
    for (const [index, item] of queued.entries()) {
      setStatus(`Uploading ${index + 1} of ${queued.length}…`);
      const form = new FormData();
      form.set("target", "expense");
      form.set("expenseId", expenseId);
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

  function save() {
    setError(null);
    setStatus(null);
    // Refused client-side too, matching what the server would say — a courtesy, not the
    // guarantee: the server checks again inside the same transaction as the write itself
    // (Appendix A "the block must still hold if someone had a page open").
    if (selectedMonthLocked) {
      setError(UI.monthLocked(monthLabel(values.month)));
      return;
    }
    startTransition(async () => {
      if (editing) {
        const result = await updateExpenseAction({
          ...values,
          id: existing!.id,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
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

      const created = await createExpenseAction(values);
      if (!created.ok) {
        setError(created.error);
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

  const highlight = autofilled ? "bg-autofill" : "bg-surface";

  // Proof of payment + Receipt, defined once: Plus renders them above the amounts, everyone
  // else below (Phase 10) — one definition so the two orders can never drift apart.
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
                  await removeExpenseDocumentAction(id),
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
                  await removeExpenseDocumentAction(id),
                  "File removed.",
                )
              ) {
                router.refresh();
              }
            })
          }
        />

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
            <Label htmlFor="noReceiptReason">
              Reason (prints on the cover sheet){" "}
              <span className="text-danger">Required</span>
            </Label>
            <Textarea
              id="noReceiptReason"
              disabled={ownSavedLocked}
              rows={2}
              value={values.noReceiptReason}
              onChange={(event) =>
                set("noReceiptReason", event.target.value)
              }
            />
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

  return (
    <div className="max-w-[560px]">
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
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave(queued, pending)) save();
        }}
      >
        <Card className="p-7 flex flex-col gap-[22px]">
          {/* `display: contents` keeps the Card's own flex layout unchanged — the fieldset
              contributes only its native disabling, in one attribute, of every input, select,
              textarea and button inside it (plan §3.11). */}
          <fieldset disabled={ownSavedLocked} className="contents">
          <div className="relative" data-tour="add-expense-name">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={values.name}
              autoComplete="off"
              onChange={(event) => set("name", event.target.value)}
              placeholder="Vendor, person, or a short label"
            />
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

          <div>
            <Label htmlFor="fundingSource">Funding source</Label>
            {options.fundingSources.length === 1 ? (
              // One source: pre-filled and not editable, no extra clicks (spec §2/§4).
              <div id="fundingSource" className="text-base py-1.5">
                {options.fundingSources[0].name}
              </div>
            ) : (
              <Select
                id="fundingSource"
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
          </div>

          <div>
            <Label id="lineItem-label" htmlFor="lineItem">
              Line item
            </Label>
            <Select
              id="lineItem"
              aria-labelledby="lineItem-label"
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
          </div>

          <div>
            <Label id="paymentSource-label" htmlFor="paymentSource">
              Payment source
            </Label>
            <Select
              id="paymentSource"
              aria-labelledby="paymentSource-label"
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
          </div>

          <div className="flex flex-wrap gap-[18px]">
            <div className="flex-1 min-w-[220px]">
              <Label id="month-label" htmlFor="month">
                Month
              </Label>
              <Select
                id="month"
                aria-labelledby="month-label"
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
            </div>
            <div className="flex-1 min-w-[220px]">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={values.date}
                onChange={(event) => set("date", event.target.value)}
              />
            </div>
          </div>

          <div data-tour="add-expense-description">
            <Label htmlFor="description">
              Description / role (prints on the cover sheet exactly as typed)
            </Label>
            <Textarea
              id="description"
              rows={2}
              className={highlight}
              value={values.description}
              onChange={(event) => set("description", event.target.value)}
            />
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
                <Label htmlFor={field} className="capitalize">
                  {field}
                </Label>
                <MoneyInput
                  id={field}
                  value={values[field]}
                  placeholder="0.00"
                  onChange={(event) => set(field, event.target.value)}
                />
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

          {showAmountSuggestionPanel && (
            <AmountSuggestionPanel
              suggestion={suggestion}
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
                      await removeExpenseDocumentAction(id),
                      "File removed.",
                    )
                  ) {
                    router.refresh();
                  }
                })
              }
            />
          </div>

          <fieldset disabled={ownSavedLocked} className="contents">
          <div className="border-t border-line pt-[22px]">
            <Label htmlFor="note">
              Note <span className="font-normal text-sub">(optional)</span>
            </Label>
            <Input
              id="note"
              value={values.note}
              onChange={(event) => set("note", event.target.value)}
            />
            <Helper>
              {/* Says what will actually print. It used to promise the tax note "whenever tax is
                entered", which stopped being true once tax became reimbursable (R6.5a). */}
              {autoNote
                ? `This note prints in addition to the automatic disclosure: ${autoNote}`
                : "Anything you leave out of the reimbursement is disclosed here automatically."}
            </Helper>
          </div>

          <div>
            <Label htmlFor="narrative">Narrative</Label>
            <Textarea
              id="narrative"
              rows={3}
              value={values.narrative}
              onChange={(event) => set("narrative", event.target.value)}
            />
            <Helper>
              Prints as a paragraph under this expense on the cover sheet.
            </Helper>
          </div>

          </fieldset>

          {error && <DangerPanel>{error}</DangerPanel>}
          {status && <div className="text-[15px] text-sub">{status}</div>}

          <div className="flex flex-wrap items-center gap-5">
            {!ownSavedLocked && (
              <Button type="submit" disabled={!canSave(queued, pending)}>
                {pending ? "Saving…" : converting ? UI.convertingPhotos : editing ? "Save changes" : "Save expense"}
              </Button>
            )}
            <Button
              variant="quiet"
              onClick={() => router.push("/r/expenses")}
              disabled={pending}
            >
              Cancel
            </Button>
            {editing && (
              <Button
                variant="quiet"
                onClick={() => setConfirmingDelete(true)}
                disabled={pending || ownSavedLocked}
              >
                Delete
              </Button>
            )}
          </div>

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
        </Card>
      </form>
    </div>
  );
}
