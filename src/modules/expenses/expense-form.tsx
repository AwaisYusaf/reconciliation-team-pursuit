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
import { exclusionNote, UI } from "@/src/domain/strings";
import { SESSION_EXPIRED } from "@/src/lib/action-result";
import { cn } from "@/src/lib/cn";

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
import { UploadField, type PendingUpload } from "./upload-field";

export type FormOptions = {
  lineItems: Array<{ id: string; name: string }>;
  paymentSources: string[];
  supportingDocTypes: string[];
  months: string[];
  /**
   * What each funder reimburses, keyed by payment source label (R1.3, D-67). Optional so the
   * type survives a caller that has not been updated; an absent entry simply leaves the
   * flags alone rather than silently asserting one funder's rules.
   */
  reimbursementRules?: Record<
    string,
    { taxReimbursable: boolean; feesReimbursable: boolean }
  >;
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
  /** Submission dates by month, already formatted — for the R10.6 warning on the month picked. */
  submittedOn?: Record<string, string>;
  today: string;
  activeMonth: string;
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
  today,
  activeMonth,
  existing,
}: ExpenseFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const editing = Boolean(existing);

  const [values, setValues] = useState<ExpenseInput>(
    existing?.values ?? {
      ...EMPTY,
      month: activeMonth,
      date: today,
      ...(options.reimbursementRules?.[options.paymentSources[0] ?? ""] ?? {}),
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

  // On the add form files are held until the expense exists, then uploaded against it.
  const [queued, setQueued] = useState<PendingUpload[]>([]);
  const [status, setStatus] = useState<string | null>(null);

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
    options.lineItems.find((item) => item.id === values.lineItemId)?.name ?? "";

  // Warn about the month the expense is heading for, not the one it came from: moving into a
  // submitted month is the case that actually changes a packet someone already received.
  const selectedMonthSubmittedOn =
    submittedOn?.[values.month] ??
    (values.month === existing?.values.month
      ? existing?.monthSubmittedOn
      : null);

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
            options.reimbursementRules,
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
    // `options.paymentSources` and the funder rules are both read when an exact match
    // autofills, so both belong here. Re-running on a new identity costs nothing: the work is
    // debounced, and the effect only starts a timer.
  }, [
    values.name,
    existing,
    options.paymentSources,
    options.reimbursementRules,
  ]);

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
        options.reimbursementRules,
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
            `Uploading ${index + 1} of ${queued.length} — waiting for the queue…`,
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

  function save() {
    setError(null);
    setStatus(null);
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
        router.push("/expenses");
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
        // they can retry rather than losing what they entered.
        setError(
          `${uploadError} — the expense was saved; add the file again from Edit.`,
        );
        router.push(`/expenses/${created.data.id}/edit`);
        router.refresh();
        return;
      }
      toast.success(savedMessage());
      router.push("/expenses");
      router.refresh();
    });
  }

  const highlight = autofilled ? "bg-autofill" : "bg-surface";

  return (
    <div className="max-w-[560px]">
      {selectedMonthSubmittedOn && (
        <DangerPanel tone="notice" className="mb-5">
          {monthLabel(values.month)} was submitted on {selectedMonthSubmittedOn}{" "}
          — changes will not alter the packet that was downloaded, but
          regenerated documents will differ.
        </DangerPanel>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) save();
        }}
      >
        <Card className="p-7 flex flex-col gap-[22px]">
          <div className="relative">
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
                  // does not say whether picking this vendor is what you want.
                  const vendorLineItem = options.lineItems.find(
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
            <Label id="lineItem-label" htmlFor="lineItem">
              Budget line item
            </Label>
            <Select
              id="lineItem"
              aria-labelledby="lineItem-label"
              value={values.lineItemId}
              className={highlight}
              onValueChange={(value) => set("lineItemId", value)}
            >
              <option value="">Choose a line item</option>
              {options.lineItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
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
              onValueChange={(value) => {
                // The funder decides what it reimburses, so choosing one applies its rules
                // (D-67) — set once per source rather than re-decided on every expense. Still
                // editable afterwards, because one expense can legitimately differ.
                const rules = options.reimbursementRules?.[value];
                setValues((current) => ({
                  ...current,
                  paymentSource: value,
                  ...(rules ?? {}),
                }));
              }}
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
                  {options.paymentSources.includes(label) ? "" : " (retired)"}
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
                onValueChange={(value) => set("month", value)}
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

          <div>
            <Label htmlFor="description">
              Description / role — this exact text will print on the cover sheet
            </Label>
            <Textarea
              id="description"
              rows={2}
              className={highlight}
              value={values.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-3.5">
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

          <div className="border-2 border-ink rounded-[3px] bg-surface px-[22px] py-5">
            <div className="text-2xl font-bold tabular-nums">
              Reimbursable amount: {formatMoney(reimbursableCents)}
            </div>
            <div className="text-[15px] text-sub mt-2 leading-relaxed tabular-nums">
              Receipt total: {formatMoney(receiptTotal)}
              {receiptTotal !== reimbursableCents && (
                <>
                  {" "}
                  — {formatMoney(receiptTotal - reimbursableCents)} not
                  reimbursed
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

          <UploadField
            label="Proof of payment"
            scope="proof"
            queued={queued}
            setQueued={setQueued}
            attached={
              existing?.documents.filter((doc) => doc.kind === "proof") ?? []
            }
            disabled={pending}
            onRemoveAttached={(id) =>
              startTransition(async () => {
                if (
                  reportResult(
                    await removeExpenseDocumentAction(id),
                    "File removed",
                  )
                ) {
                  router.refresh();
                }
              })
            }
          />

          <div className="border-t border-line pt-[22px]">
            <UploadField
              label="Receipt / justification (receipt, invoice, or timesheet)"
              scope="receipt"
              queued={queued}
              setQueued={setQueued}
              attached={
                existing?.documents.filter((doc) => doc.kind === "receipt") ??
                []
              }
              disabled={pending || values.noReceipt}
              hidden={values.noReceipt}
              onRemoveAttached={(id) =>
                startTransition(async () => {
                  if (
                    reportResult(
                      await removeExpenseDocumentAction(id),
                      "File removed",
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
                  rows={2}
                  value={values.noReceiptReason}
                  onChange={(event) =>
                    set("noReceiptReason", event.target.value)
                  }
                />
                {attachedReceipts.length > 0 && (
                  <Helper className="text-danger">
                    Saving with this ticked removes the{" "}
                    {attachedReceipts.length} receipt file
                    {attachedReceipts.length === 1 ? "" : "s"} already attached.
                  </Helper>
                )}
              </div>
            )}
          </div>

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
              disabled={pending}
              supportingTypes={options.supportingDocTypes}
              onRemoveAttached={(id) =>
                startTransition(async () => {
                  if (
                    reportResult(
                      await removeExpenseDocumentAction(id),
                      "File removed",
                    )
                  ) {
                    router.refresh();
                  }
                })
              }
            />
          </div>

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
            <Label htmlFor="narrative">
              Narrative <span className="font-normal text-sub">(optional)</span>
            </Label>
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

          {error && <DangerPanel>{error}</DangerPanel>}
          {status && <div className="text-[15px] text-sub">{status}</div>}

          <div className="flex flex-wrap items-center gap-5">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save changes" : "Save expense"}
            </Button>
            <Button
              variant="quiet"
              onClick={() => router.push("/expenses")}
              disabled={pending}
            >
              Cancel
            </Button>
            {editing && (
              <Button
                variant="quiet"
                onClick={() => setConfirmingDelete(true)}
                disabled={pending}
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
                      router.push("/expenses");
                      router.refresh();
                    });
                  },
                }}
              >
                It moves to the trash with its {existing!.documents.length} attached file
                {existing!.documents.length === 1 ? "" : "s"}, and can be restored.
              </Dialog>
            </>
          )}
        </Card>
      </form>
    </div>
  );
}
