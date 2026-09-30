"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/src/components/ui/button";
import { FieldError, Input, invalidProps, MoneyInput } from "@/src/components/ui/field";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatMoney } from "@/src/domain/format";
import { parseMoneyToCentsOrZero, sumBy } from "@/src/domain/money";
import { UI } from "@/src/domain/strings";
import { saveOnboardingLineItemsAction } from "@/src/modules/auth/actions";

type Row = { name: string; budget: string };
/** A row's own problem, on the box that is wrong (PR #27). */
type RowError = { field: "name" | "amount"; message: string };

/** A draft is client data too: only an array of `{ name, budget }` strings is used. */
function readDraft(key: string): Row[] | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!Array.isArray(value) || value.length > 200) return null;
    const rows: Row[] = [];
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null) return null;
      const { name, budget } = entry as Record<string, unknown>;
      if (typeof name !== "string" || typeof budget !== "string") return null;
      rows.push({ name, budget });
    }
    return rows;
  } catch {
    return null;
  }
}

export function OnboardingLineItemsForm({
  orgId,
  initialRows,
  totalCents,
}: {
  orgId: string;
  initialRows: Row[];
  totalCents: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(initialRows);
  /** The refusal above Finish: a row problem ("check the line items marked") or a whole-form one
   *  (over the total, no line items). */
  const [error, setError] = useState<string | null>(null);
  /** Each row's own error, lined up with `rows`: editing a row clears only its own, removing a
   *  row drops its own and moves the ones below up with their rows. */
  const [rowErrors, setRowErrors] = useState<(RowError | undefined)[]>([]);

  /** What this person typed on this step, kept in this tab. The line items are only saved when
   *  Finish succeeds, so without this, going back to fix the total (the step the over-total
   *  message sends people to) threw the whole table away. Unread once onboarding finishes, since
   *  both steps then send the person to the app.
   *  ponytail: tab-scoped (sessionStorage), so closing the tab loses it; localStorage or a
   *  server draft if people ask to resume on another device. */
  const draftKey = `onboarding-line-items:${orgId}`;

  // Restored once after mount, a frame later: setting state straight inside an effect trips
  // `react-hooks/set-state-in-effect`, and deferring by a frame is the accepted fix (tour.tsx).
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const draft = readDraft(draftKey);
      if (draft) setRows(draft);
    });
    return () => cancelAnimationFrame(frame);
  }, [draftKey]);

  /** Set by a refused Finish: once the rows are enabled again, focus goes to the box that is
   *  wrong in the first marked row (disabling them while saving dropped it), so a keyboard user
   *  lands on what to fix. */
  const focusFirstError = useRef(false);
  useEffect(() => {
    if (pending || !focusFirstError.current) return;
    focusFirstError.current = false;
    const first = rowErrors.findIndex(Boolean);
    if (first >= 0) document.getElementById(`row-${first}-${rowErrors[first]!.field}`)?.focus();
  }, [pending, rowErrors]);

  /** Every change by the person keeps the draft. Nothing is written on mount. */
  function change(next: Row[], nextRowErrors: (RowError | undefined)[]) {
    setRows(next);
    setRowErrors(nextRowErrors);
    // A whole-form refusal is out of date once anything changes; the row one stays while any
    // marked row is left.
    if (!nextRowErrors.some(Boolean)) setError(null);
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(next));
    } catch {
      /* storage blocked or full: the form still works */
    }
  }

  function update(index: number, patch: Partial<Row>) {
    change(
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      rowErrors.map((message, i) => (i === index ? undefined : message)),
    );
  }

  function remove(index: number) {
    change(
      rows.filter((_, i) => i !== index),
      rowErrors.filter((_, i) => i !== index),
    );
  }

  // The same parser the server uses, so what the person sees here is what gets checked.
  const plannedCents = sumBy(rows, (row) => parseMoneyToCentsOrZero(row.budget));
  const over = plannedCents > totalCents;

  // A plain onSubmit (rather than a `<form action>`) so a rejected submission never triggers
  // React's automatic form reset — that reset fires whenever the action resolves, including
  // on a validation failure, and was wiping every typed row over one bad entry. Every control is
  // disabled while it runs, so the rows the answer is about are the rows still on screen.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submitted = rows.length;
    startTransition(async () => {
      const result = await saveOnboardingLineItemsAction({ ok: false, error: "" }, formData);
      if (result.ok) return;
      focusFirstError.current = true;
      setError(result.error);
      // The server keys row errors by the submitted position and the box (`row-N-name`,
      // `row-N-amount`), blank rows included.
      setRowErrors(
        Array.from({ length: submitted }, (_, i): RowError | undefined => {
          const name = result.fieldErrors?.[`row-${i}-name`];
          if (name) return { field: "name", message: name };
          const amount = result.fieldErrors?.[`row-${i}-amount`];
          return amount ? { field: "amount", message: amount } : undefined;
        }),
      );
    });
  }

  return (
    <form onSubmit={onSubmit}>
      {/* No minimum width: at 375px a row stacks (the name on its own line, then the amount and
          Remove), so nothing scrolls sideways (PR #27). Below `sm` the table and its body are
          plain blocks: left as a table, it sized itself to the inputs' natural width and still
          scrolled inside the card. The heading band is for the columns, which only exist from
          `sm`. */}
      <TableCard className="max-sm:[&_table]:block max-sm:[&_tbody]:block">
        <thead className="max-sm:hidden">
          <tr>
            <Th>Line item</Th>
            <Th align="right" className="w-[220px]">
              Amount
            </Th>
            <Th align="right" className="w-[110px]">
              Remove
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowError = rowErrors[index];
            const nameError = rowError?.field === "name" ? rowError.message : undefined;
            const amountError = rowError?.field === "amount" ? rowError.message : undefined;
            return (
              <tr key={index} className="max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-start">
                <Td className="py-2.5! align-top max-sm:col-span-2 max-sm:pb-1! max-sm:border-b-0">
                  <Input
                    id={`row-${index}-name`}
                    name="lineItemName"
                    value={row.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                    aria-label={`Line item ${index + 1} name`}
                    placeholder="Line item name"
                    disabled={pending}
                    {...invalidProps(`row-${index}-name-error`, nameError)}
                  />
                  {nameError && <FieldError id={`row-${index}-name-error`}>{nameError}</FieldError>}
                </Td>
                <Td className="py-2.5! align-top max-sm:pt-1!">
                  <MoneyInput
                    id={`row-${index}-amount`}
                    name="lineItemBudget"
                    value={row.budget}
                    onChange={(event) => update(index, { budget: event.target.value })}
                    aria-label={`Line item ${index + 1} amount`}
                    placeholder="0.00"
                    disabled={pending}
                    {...invalidProps(`row-${index}-amount-error`, amountError)}
                  />
                  {amountError && <FieldError id={`row-${index}-amount-error`}>{amountError}</FieldError>}
                </Td>
                <Td align="right" className="py-2.5! align-top max-sm:pt-1!">
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    disabled={pending}
                    aria-label={`Remove ${row.name.trim() || `line item ${index + 1}`}`}
                    className="py-2.5 text-[15px] text-accent underline hover:text-accent-dark disabled:text-disabled-ink disabled:no-underline disabled:cursor-not-allowed"
                  >
                    Remove
                  </button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableCard>

      <div className="flex flex-wrap items-center justify-between gap-4 mt-5">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => change([...rows, { name: "", budget: "" }], [...rowErrors, undefined])}
        >
          Add line item
        </Button>
        <div
          aria-live="polite"
          className={over ? "text-base font-bold tabular-nums text-danger" : "text-base font-bold tabular-nums text-ink"}
        >
          {UI.onboardingPlanned(
            formatMoney(plannedCents),
            formatMoney(totalCents),
            formatMoney(Math.abs(totalCents - plannedCents)),
            over,
          )}
        </div>
      </div>

      {/* Above Finish, where the person is looking when it is refused (as on Add Expense). */}
      {error && <DangerPanel className="mt-6">{error}</DangerPanel>}

      <div className="h-6" />
      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Saving…" : "Finish setup"}
      </Button>

      <div className="text-center mt-4">
        <Button type="button" variant="quiet" disabled={pending} onClick={() => router.push("/onboarding/funding")}>
          Back to your funding
        </Button>
      </div>
    </form>
  );
}
