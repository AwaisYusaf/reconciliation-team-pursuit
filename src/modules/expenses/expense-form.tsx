"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Helper, Input, Label, MoneyInput, Select, Textarea } from "@/src/components/ui/field";
import { Card, DangerPanel } from "@/src/components/ui/surfaces";
import { projectedRemainingCents } from "@/src/domain/budget-math";
import { monthLabel } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { parseMoneyToCentsOrZero } from "@/src/domain/money";
import { TAX_NOTE, UI } from "@/src/domain/strings";
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
};

export type RemainingByLineItem = Record<string, number>;

export type ExpenseFormProps = {
  options: FormOptions;
  /** Remaining budget per line item for the active month, for the live projection (R3.7). */
  remaining: RemainingByLineItem;
  today: string;
  activeMonth: string;
  /** Present in edit mode. */
  existing?: {
    id: string;
    values: ExpenseInput;
    documents: AttachedDocument[];
    /** The saved reimbursable amount, restored before projecting so an edit cannot double-count. */
    savedReimbursableCents: number;
    monthSubmitted: boolean;
  };
};

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
  note: "",
  narrative: "",
  noReceipt: false,
  noReceiptReason: "",
};

export function ExpenseForm({ options, remaining, today, activeMonth, existing }: ExpenseFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const editing = Boolean(existing);

  const [values, setValues] = useState<ExpenseInput>(
    existing?.values ?? { ...EMPTY, month: activeMonth, date: today },
  );
  const [error, setError] = useState<string | null>(null);
  const [autofilled, setAutofilled] = useState(false);
  const [suggestions, setSuggestions] = useState<
    Array<{ name: string; lineItemId: string | null; description: string }>
  >([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // On the add form files are held until the expense exists, then uploaded against it.
  const [queued, setQueued] = useState<PendingUpload[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const set = useCallback(
    <K extends keyof ExpenseInput>(key: K, value: ExpenseInput[K]) =>
      setValues((current) => ({ ...current, [key]: value })),
    [],
  );

  const reimbursableCents = useMemo(
    () => parseMoneyToCentsOrZero(values.subtotal) + parseMoneyToCentsOrZero(values.fees),
    [values.subtotal, values.fees],
  );

  const taxCents = parseMoneyToCentsOrZero(values.tax);

  const projection = useMemo(() => {
    if (!values.lineItemId) return null;
    const base = remaining[values.lineItemId];
    if (base === undefined) return null;
    // The saved amount is only inside this line item's remaining figure when the expense
    // has not been moved to a different line item.
    const sameLineItem = existing?.values.lineItemId === values.lineItemId;
    return projectedRemainingCents({
      remainingCents: base,
      formReimbursableCents: reimbursableCents,
      editingExistingCents: sameLineItem ? existing?.savedReimbursableCents : 0,
    });
  }, [values.lineItemId, remaining, reimbursableCents, existing]);

  const lineItemName = options.lineItems.find((item) => item.id === values.lineItemId)?.name ?? "";

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
      if (!result.ok) return;
      const exact = result.data.find((row) => row.name.toLowerCase() === term.toLowerCase());
      if (exact && exact.lineItemId) {
        setValues((current) =>
          current.lineItemId || current.description
            ? current
            : { ...current, lineItemId: exact.lineItemId!, description: exact.description },
        );
        setAutofilled(true);
        setTimeout(() => setAutofilled(false), 1400);
        setSuggestions([]);
      } else {
        setSuggestions(result.data.filter((row) => row.name.toLowerCase() !== term.toLowerCase()));
      }
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [values.name, existing]);

  function pickSuggestion(row: { name: string; lineItemId: string | null; description: string }) {
    setValues((current) => ({
      ...current,
      name: row.name,
      lineItemId: current.lineItemId || (row.lineItemId ?? ""),
      // Never overwrite text the user has typed — the label says it prints on the cover sheet.
      description: current.description || row.description,
    }));
    setSuggestions([]);
    setAutofilled(true);
    setTimeout(() => setAutofilled(false), 1400);
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
        const response = await fetch("/api/files/upload", { method: "POST", body: form });
        const result = (await response.json()) as { ok: boolean; error?: string };
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
        const result = await updateExpenseAction({ ...values, id: existing!.id });
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
        setError(`${uploadError} — the expense was saved; add the file again from Edit.`);
        router.push(`/expenses/${created.data.id}/edit`);
        router.refresh();
        return;
      }
      router.push("/expenses");
      router.refresh();
    });
  }

  const highlight = autofilled ? "bg-autofill" : "bg-surface";

  return (
    <div className="max-w-[560px]">
      {existing?.monthSubmitted && (
        <DangerPanel tone="notice" className="mb-5">
          This month was already submitted. Changes will not alter the packet that was
          downloaded, but regenerated documents will differ.
        </DangerPanel>
      )}

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
              {suggestions.map((row) => (
                <button
                  key={row.name}
                  type="button"
                  onClick={() => pickSuggestion(row)}
                  className="block w-full text-left px-3.5 py-3 text-base border-b border-line last:border-b-0 hover:bg-section min-h-11"
                >
                  {row.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="lineItem">Budget line item</Label>
          <Select
            id="lineItem"
            value={values.lineItemId}
            className={highlight}
            onChange={(event) => set("lineItemId", event.target.value)}
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
          <Label htmlFor="paymentSource">Payment source</Label>
          <Select
            id="paymentSource"
            value={values.paymentSource}
            onChange={(event) => set("paymentSource", event.target.value)}
          >
            <option value="">Choose a payment source</option>
            {options.paymentSources.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-wrap gap-[18px]">
          <div className="flex-1 min-w-[220px]">
            <Label htmlFor="month">Month</Label>
            <Select id="month" value={values.month} onChange={(event) => set("month", event.target.value)}>
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

        <div className="border-2 border-ink rounded-[3px] bg-surface px-[22px] py-5">
          <div className="text-2xl font-bold tabular-nums">
            Reimbursable amount: {formatMoney(reimbursableCents)}
          </div>
          <div className="text-[15px] text-sub mt-2 leading-relaxed">{UI.reimburseHint}</div>
        </div>

        {projection !== null && (
          <div
            className={
              projection < 0
                ? "text-[15px] font-bold text-danger tabular-nums"
                : "text-[15px] text-sub tabular-nums"
            }
          >
            Remaining on {lineItemName} after this expense: {formatMoney(projection)}
          </div>
        )}

        <UploadField
          label="Proof of payment"
          scope="proof"
          queued={queued}
          setQueued={setQueued}
          attached={existing?.documents.filter((doc) => doc.kind === "proof") ?? []}
          disabled={pending}
          onRemoveAttached={(id) =>
            startTransition(async () => {
              await removeExpenseDocumentAction(id);
              router.refresh();
            })
          }
        />

        <div className="border-t border-line pt-[22px]">
          <UploadField
            label="Receipt / justification (receipt, invoice, or timesheet)"
            scope="receipt"
            queued={queued}
            setQueued={setQueued}
            attached={existing?.documents.filter((doc) => doc.kind === "receipt") ?? []}
            disabled={pending || values.noReceipt}
            hidden={values.noReceipt}
            onRemoveAttached={(id) =>
              startTransition(async () => {
                await removeExpenseDocumentAction(id);
                router.refresh();
              })
            }
          />

          <label className="flex items-center gap-2.5 mt-3.5 text-base cursor-pointer min-h-11">
            <input
              type="checkbox"
              checked={values.noReceipt}
              onChange={(event) => {
                const checked = event.target.checked;
                set("noReceipt", checked);
                // R4.2: drop any queued receipt files too, or they would upload after the
                // save and leave the expense both marked "no receipt" and holding one.
                if (checked) setQueued((current) => current.filter((item) => item.scope !== "receipt"));
              }}
              className="w-5 h-5 accent-accent"
            />
            <span>No receipt available</span>
          </label>

          {values.noReceipt && (
            <div className="mt-2">
              <Label htmlFor="noReceiptReason">
                Reason (prints on the cover sheet) <span className="text-danger">Required</span>
              </Label>
              <Textarea
                id="noReceiptReason"
                rows={2}
                value={values.noReceiptReason}
                onChange={(event) => set("noReceiptReason", event.target.value)}
              />
              {existing?.documents.some((doc) => doc.kind === "receipt") && (
                <Helper className="text-danger">
                  Saving with this ticked removes the receipt files already attached.
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
            attached={existing?.documents.filter((doc) => doc.kind === "supporting") ?? []}
            disabled={pending}
            supportingTypes={options.supportingDocTypes}
            onRemoveAttached={(id) =>
              startTransition(async () => {
                await removeExpenseDocumentAction(id);
                router.refresh();
              })
            }
          />
        </div>

        <div className="border-t border-line pt-[22px]">
          <Label htmlFor="note">
            Note <span className="font-normal text-sub">(optional)</span>
          </Label>
          <Input id="note" value={values.note} onChange={(event) => set("note", event.target.value)} />
          <Helper>
            {taxCents > 0
              ? `Tax is entered, so this note prints in addition to the standard tax note: ${TAX_NOTE}`
              : "If tax is entered, the standard tax note prints automatically as well."}
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
          <Helper>Prints as a paragraph under this expense on the cover sheet.</Helper>
        </div>

        {error && <DangerPanel>{error}</DangerPanel>}
        {status && <div className="text-[15px] text-sub">{status}</div>}

        <div className="flex flex-wrap items-center gap-5">
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Save expense"}
          </Button>
          <Button variant="quiet" onClick={() => router.push("/expenses")} disabled={pending}>
            Cancel
          </Button>
          {editing && !confirmingDelete && (
            <Button variant="quiet" onClick={() => setConfirmingDelete(true)} disabled={pending}>
              Delete
            </Button>
          )}
        </div>

        {editing && confirmingDelete && (
          <DangerPanel title="Delete this expense?">
            <p className="mb-3">
              Its {existing!.documents.length} attached file
              {existing!.documents.length === 1 ? "" : "s"} will be removed too. This cannot be
              undone.
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await deleteExpenseAction(existing!.id);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    router.push("/expenses");
                    router.refresh();
                  })
                }
              >
                Delete expense
              </Button>
              <Button variant="quiet" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </Button>
            </div>
          </DangerPanel>
        )}
      </Card>
    </div>
  );
}
