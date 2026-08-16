"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Helper, Input, Label, MoneyInput, Select } from "@/src/components/ui/field";
import { Card, DangerPanel, EmptyState } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
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
  added: boolean;
};

type Draft = { id?: string; name: string; amount: string; lineItemId: string; defaultDescription: string };

const EMPTY_DRAFT: Draft = { name: "", amount: "", lineItemId: "", defaultDescription: "" };

export function RecurringManager({
  rows,
  lineItems,
  month,
  monthLabel,
  monthShort,
}: {
  rows: RecurringRow[];
  lineItems: Array<{ id: string; name: string }>;
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

  function run(work: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  function add(row: RecurringRow) {
    setJustChanged(row.id);
    run(() => addRecurringToMonthAction(row.id, month));
  }

  function remove(row: RecurringRow) {
    setError(null);
    startTransition(async () => {
      const result = await removeRecurringFromMonthAction(row.id, month, false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Removing an expense that already carries uploaded evidence is confirmed first.
      if (result.data?.requiresConfirmation) {
        setConfirmRemove({
          row,
          message: removeConfirmation(row.name, Number(result.data.requiresConfirmation)),
        });
        return;
      }
      setJustChanged(row.id);
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

      {confirmRemove && (
        <DangerPanel title="Remove from this month?" className="mb-4">
          <p className="mb-3">{confirmRemove.message}</p>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(
                  () => removeRecurringFromMonthAction(confirmRemove.row.id, month, true),
                  () => setConfirmRemove(null),
                )
              }
            >
              Remove anyway
            </Button>
            <Button variant="quiet" onClick={() => setConfirmRemove(null)}>
              Keep it
            </Button>
          </div>
        </DangerPanel>
      )}

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
              <Label htmlFor="rec-line">Line item</Label>
              <Select
                id="rec-line"
                value={draft.lineItemId}
                onChange={(event) => setDraft({ ...draft, lineItemId: event.target.value })}
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

          <div className="flex flex-wrap gap-3 mt-5">
            <Button
              disabled={pending}
              onClick={() => run(() => saveRecurringItemAction(draft), () => setDraft(null))}
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
                  run(() => deleteRecurringItemAction(draft.id!), () => setDraft(null))
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
