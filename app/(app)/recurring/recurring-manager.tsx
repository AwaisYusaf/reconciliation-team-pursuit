"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";
import { Helper, Input, Label, MoneyInput, Textarea } from "@/src/components/ui/field";
import { Select } from "@/src/components/ui/select";
import { Card, DangerPanel, EmptyState } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { reportResult } from "@/src/components/ui/toast";
import type { ActionResult } from "@/src/lib/action-result";
import { formatMoney } from "@/src/domain/format";
import { removeConfirmation } from "@/src/domain/recurring-rules";
import {
  addRecurringToMonthAction,
  deleteRecurringItemAction,
  removeRecurringFromMonthAction,
  saveRecurringItemAction,
} from "@/src/modules/recurring/actions";

export type RecurringRow = {
  id: string;
  name: string;
  amountCents: number;
  lineItemId: string;
  lineItemName: string;
  defaultDescription: string;
  defaultNarrative: string;
  defaultPaymentSource: string;
  defaultTax: string;
  defaultFees: string;
  added: boolean;
};

type Draft = {
  id?: string;
  name: string;
  amount: string;
  lineItemId: string;
  defaultDescription: string;
  defaultNarrative: string;
  defaultPaymentSource: string;
  defaultTax: string;
  defaultFees: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  amount: "",
  lineItemId: "",
  defaultDescription: "",
  defaultNarrative: "",
  defaultPaymentSource: "",
  defaultTax: "",
  defaultFees: "",
};

export function RecurringManager({
  rows,
  lineItems,
  paymentSources,
  month,
  monthLabel,
  monthShort,
}: {
  rows: RecurringRow[];
  lineItems: Array<{ id: string; name: string }>;
  paymentSources: string[];
  month: string;
  monthLabel: string;
  monthShort: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ row: RecurringRow; message: string } | null>(
    null,
  );
  const [justChanged, setJustChanged] = useState<string | null>(null);

  function run(
    work: () => Promise<ActionResult<unknown>>,
    onDone?: () => void,
    successMessage?: string,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!reportResult(result, successMessage)) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  /** The green row flash is a transient confirmation, so it clears itself. */
  function flash(id: string) {
    setJustChanged(id);
    setTimeout(() => setJustChanged((current) => (current === id ? null : current)), 2500);
  }

  function add(row: RecurringRow) {
    // The flash confirms the add, so it must wait for the add to succeed. It used to fire
    // first, which meant a failed add still went green — exactly how a live insert failure
    // stayed invisible on this screen (TASKS.md U2).
    run(
      () => addRecurringToMonthAction(row.id, month),
      () => flash(row.id),
      `${row.name} added to ${monthLabel}`,
    );
  }

  function remove(row: RecurringRow) {
    setError(null);
    startTransition(async () => {
      const result = await removeRecurringFromMonthAction(row.id, month, false);
      if (!result.ok) {
        setError(result.error);
        reportResult(result);
        return;
      }
      // Confirmed first when files would be lost, and always when the expense was entered
      // by hand rather than added from here — deleting someone's own record is a different
      // act from undoing a click.
      if (result.data?.requiresConfirmation) {
        setConfirmRemove({
          row,
          message: removeConfirmation(
            row.name,
            Number(result.data.requiresConfirmation),
            result.data.createdByThisItem !== false,
          ),
        });
        return;
      }
      flash(row.id);
      router.refresh();
    });
  }

  return (
    <div>
      {error && (
        <DangerPanel tone="notice" className="mb-4">
          {error}
        </DangerPanel>
      )}

      <Dialog
        open={confirmRemove !== null}
        title="Remove from this month?"
        dismissLabel="Keep it"
        onDismiss={() => setConfirmRemove(null)}
        confirm={{
          label: "Remove anyway",
          disabled: pending,
          onConfirm: () => {
            const row = confirmRemove!.row;
            startTransition(async () => {
              setError(null);
              const result = await removeRecurringFromMonthAction(row.id, month, true);
              // Stays open (Remove disabled via `pending`) until the outcome is known, so the
              // dialog doesn't vanish out from under a failure the general error banner is
              // about to show — the dialog would otherwise hide that banner behind its overlay.
              setConfirmRemove(null);
              if (reportResult(result, "Removed from this month")) router.refresh();
              else setError(result.error ?? "Something went wrong.");
            });
          },
        }}
      >
        {confirmRemove?.message}
      </Dialog>

      {rows.length === 0 ? (
        <EmptyState>
          No recurring items yet. Add the vendors and salaries that repeat every month.
        </EmptyState>
      ) : (
        <TableCard minWidth={860}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th align="right" className="w-[150px]">
                Amount
              </Th>
              <Th>Line Item</Th>
              <Th align="right" className="w-[320px]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={justChanged === row.id ? "bg-success-bg" : undefined}>
                <Td>{row.name}</Td>
                <Td align="right" numeric>
                  {formatMoney(row.amountCents)}
                </Td>
                <Td>{row.lineItemName}</Td>
                <Td align="right">
                  <div className="flex items-center justify-end gap-4 flex-wrap">
                    <Button
                      variant="quiet"
                      disabled={pending}
                      onClick={() =>
                        setDraft({
                          defaultNarrative: row.defaultNarrative,
                          defaultPaymentSource: row.defaultPaymentSource,
                          defaultTax: row.defaultTax,
                          defaultFees: row.defaultFees,
                          id: row.id,
                          name: row.name,
                          amount: (row.amountCents / 100).toFixed(2),
                          lineItemId: row.lineItemId,
                          defaultDescription: row.defaultDescription,
                        })
                      }
                    >
                      Edit
                    </Button>

                    {row.added ? (
                      <div className="flex items-center gap-3.5">
                        <span className="text-sm font-bold text-success whitespace-nowrap">
                          ✓ Added to {monthLabel}
                        </span>
                        <Button
                          variant="quiet"
                          className="min-h-9"
                          disabled={pending}
                          onClick={() => remove(row)}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="secondary"
                        className="min-h-11 px-4 text-[15px] whitespace-nowrap"
                        disabled={pending}
                        onClick={() => add(row)}
                      >
                        Add to {monthShort}
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      {!draft ? (
        <div className="mt-6">
          <Button variant="secondary" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            + Add recurring item
          </Button>
        </div>
      ) : (
        <Card className="mt-8 p-6 max-w-[860px]">
          <div className="flex flex-wrap gap-4">
            <div className="flex-[2] min-w-[220px]">
              <Label htmlFor="rec-name">Name</Label>
              <Input
                id="rec-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <Label htmlFor="rec-amount">Amount</Label>
              <MoneyInput
                id="rec-amount"
                value={draft.amount}
                placeholder="0.00"
                onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
              />
            </div>
            <div className="flex-[2] min-w-[220px]">
              <Label id="rec-line-label" htmlFor="rec-line">Line item</Label>
              <Select
                id="rec-line"
                aria-labelledby="rec-line-label"
                value={draft.lineItemId}
                onValueChange={(value) => setDraft({ ...draft, lineItemId: value })}
              >
                <option value="">Choose a line item</option>
                {lineItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="mt-[18px]">
            <Label htmlFor="rec-desc">
              Default description <span className="font-normal text-sub">(optional)</span>
            </Label>
            <Input
              id="rec-desc"
              value={draft.defaultDescription}
              onChange={(event) => setDraft({ ...draft, defaultDescription: event.target.value })}
            />
            <Helper>Used as the cover-sheet role when this item is added to a month.</Helper>
          </div>

          <div className="mt-[18px]">
            <Label htmlFor="rec-narrative">
              Default narrative <span className="font-normal text-sub">(optional)</span>
            </Label>
            <Textarea
              id="rec-narrative"
              rows={3}
              value={draft.defaultNarrative}
              onChange={(event) => setDraft({ ...draft, defaultNarrative: event.target.value })}
            />
            <Helper>
              Fills in automatically each month and stays editable. Correcting it on the expense
              updates this, so next month starts from the current wording.
            </Helper>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-[18px]">
            <div>
              <Label id="rec-source-label" htmlFor="rec-source">
                Payment source <span className="font-normal text-sub">(optional)</span>
              </Label>
              <Select
                id="rec-source"
                aria-labelledby="rec-source-label"
                value={draft.defaultPaymentSource}
                onValueChange={(value) => setDraft({ ...draft, defaultPaymentSource: value })}
              >
                <option value="">Use the default</option>
                {paymentSources.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="rec-tax">
                Tax <span className="font-normal text-sub">(optional)</span>
              </Label>
              <MoneyInput
                id="rec-tax"
                placeholder="0.00"
                value={draft.defaultTax}
                onChange={(event) => setDraft({ ...draft, defaultTax: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="rec-fees">
                Fees <span className="font-normal text-sub">(optional)</span>
              </Label>
              <MoneyInput
                id="rec-fees"
                placeholder="0.00"
                value={draft.defaultFees}
                onChange={(event) => setDraft({ ...draft, defaultFees: event.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mt-5">
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () => saveRecurringItemAction(draft),
                  () => setDraft(null),
                  draft.id ? "Recurring item saved" : "Recurring item added",
                )
              }
            >
              {draft.id ? "Save changes" : "Add recurring item"}
            </Button>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            {draft.id && (
              <Button
                variant="quiet"
                disabled={pending}
                onClick={() =>
                  run(
                    () => deleteRecurringItemAction(draft.id!),
                    () => setDraft(null),
                    "Removed from the recurring list",
                  )
                }
              >
                Delete from list
              </Button>
            )}
          </div>
          {draft.id && (
            <Helper>Deleting the list entry leaves any expenses already added untouched.</Helper>
          )}
        </Card>
      )}
    </div>
  );
}
