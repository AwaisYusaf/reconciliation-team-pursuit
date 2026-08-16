"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Input, Label, MoneyInput } from "@/src/components/ui/field";
import { Card, DangerPanel } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatMoney } from "@/src/domain/format";
import { cascadeConfirmation, moveInOrder } from "@/src/domain/line-item-rules";
import {
  deleteLineItemAction,
  reorderLineItemsAction,
  saveLineItemAction,
} from "@/src/modules/line-items/actions";
import type { LineItemRow } from "@/src/modules/line-items/queries";

/** Cents → the editable string form, so an edit round-trips without reformatting surprises. */
function toInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function LineItemsManager({ rows }: { rows: LineItemRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", scheduledValue: "", openingBilled: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState({ name: "", scheduledValue: "", openingBilled: "" });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; recurring: string[] } | null>(
    null,
  );

  function run(work: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        onDone?.();
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  function startEdit(row: LineItemRow) {
    setEditingId(row.id);
    setError(null);
    setDraft({
      name: row.name,
      scheduledValue: toInput(row.scheduledValueCents),
      openingBilled: toInput(row.openingBilledCents),
    });
  }

  function move(index: number, delta: number) {
    const next = moveInOrder(rows, index, delta);
    if (next[index] === rows[index]) return;
    run(() => reorderLineItemsAction(next.map((row) => row.id)));
  }

  function remove(row: LineItemRow) {
    startTransition(async () => {
      setError(null);
      const result = await deleteLineItemAction(row.id, false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Deleting also removes recurring items, so the user confirms the list first (R9.3).
      if (result.data?.requiresConfirmation?.length) {
        setConfirmDelete({ id: row.id, recurring: result.data.requiresConfirmation });
        return;
      }
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

      {confirmDelete && (
        <DangerPanel title="Delete this line item?" className="mb-4">
          <p className="mb-3">{cascadeConfirmation(confirmDelete.recurring)}</p>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(() => deleteLineItemAction(confirmDelete.id, true), () =>
                  setConfirmDelete(null),
                )
              }
            >
              Delete anyway
            </Button>
            <Button variant="quiet" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
          </div>
        </DangerPanel>
      )}

      <TableCard minWidth={900}>
        <thead>
          <tr>
            <Th className="w-10" aria-label="Reorder" />
            <Th>Line Item Name</Th>
            <Th align="right">Scheduled Value</Th>
            <Th align="right">Opening Previously Billed</Th>
            <Th align="right" className="w-[210px]">
              Actions
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const editing = editingId === row.id;
            return (
              <tr key={row.id}>
                <Td className="pl-4 pr-2 text-sub select-none">
                  <div className="flex flex-col leading-none">
                    <button
                      type="button"
                      aria-label={`Move ${row.name} up`}
                      disabled={pending || index === 0}
                      onClick={() => move(index, -1)}
                      className="px-1 text-sub hover:text-ink disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${row.name} down`}
                      disabled={pending || index === rows.length - 1}
                      onClick={() => move(index, 1)}
                      className="px-1 text-sub hover:text-ink disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>
                </Td>

                {editing ? (
                  <>
                    <Td className="py-3">
                      <Input
                        value={draft.name}
                        aria-label="Line item name"
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </Td>
                    <Td align="right" className="py-3">
                      <MoneyInput
                        value={draft.scheduledValue}
                        aria-label="Scheduled value"
                        onChange={(event) =>
                          setDraft({ ...draft, scheduledValue: event.target.value })
                        }
                      />
                    </Td>
                    <Td align="right" className="py-3">
                      <MoneyInput
                        value={draft.openingBilled}
                        aria-label="Opening previously billed"
                        onChange={(event) =>
                          setDraft({ ...draft, openingBilled: event.target.value })
                        }
                      />
                    </Td>
                    <Td align="right" className="py-3">
                      <div className="flex gap-3.5 items-center justify-end">
                        <Button
                          variant="secondary"
                          className="min-h-11 px-4 text-[15px]"
                          disabled={pending}
                          onClick={() =>
                            run(() => saveLineItemAction({ id: row.id, ...draft }), () =>
                              setEditingId(null),
                            )
                          }
                        >
                          Save
                        </Button>
                        <Button variant="quiet" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </Td>
                  </>
                ) : (
                  <>
                    <Td>{row.name}</Td>
                    <Td align="right" numeric>
                      {formatMoney(row.scheduledValueCents)}
                    </Td>
                    <Td align="right" numeric>
                      {formatMoney(row.openingBilledCents)}
                    </Td>
                    <Td align="right">
                      <div className="flex gap-4 justify-end">
                        <Button variant="quiet" onClick={() => startEdit(row)} disabled={pending}>
                          Edit
                        </Button>
                        <Button variant="quiet" onClick={() => remove(row)} disabled={pending}>
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </TableCard>

      {!showAdd ? (
        <div className="mt-6">
          <Button variant="secondary" onClick={() => setShowAdd(true)}>
            + Add line item
          </Button>
        </div>
      ) : (
        <Card className="mt-8 p-6 max-w-[720px]">
          <div className="mb-[18px]">
            <Label htmlFor="new-name">Line item name</Label>
            <Input
              id="new-name"
              value={addDraft.name}
              onChange={(event) => setAddDraft({ ...addDraft, name: event.target.value })}
            />
          </div>

          <div className="flex flex-wrap gap-[18px]">
            <div className="flex-1 min-w-[220px]">
              <Label htmlFor="new-scheduled">Scheduled value</Label>
              <MoneyInput
                id="new-scheduled"
                value={addDraft.scheduledValue}
                placeholder="0.00"
                onChange={(event) =>
                  setAddDraft({ ...addDraft, scheduledValue: event.target.value })
                }
              />
            </div>
            <div className="flex-1 min-w-[220px]">
              <Label htmlFor="new-opening">
                Opening previously billed <span className="font-normal text-sub">(optional)</span>
              </Label>
              <MoneyInput
                id="new-opening"
                value={addDraft.openingBilled}
                placeholder="0.00"
                onChange={(event) =>
                  setAddDraft({ ...addDraft, openingBilled: event.target.value })
                }
              />
              <div className="text-sm text-sub mt-1.5 leading-relaxed">
                Amount already billed before you started using this system.
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mt-[22px]">
            <Button
              disabled={pending}
              onClick={() =>
                run(() => saveLineItemAction(addDraft), () => {
                  setShowAdd(false);
                  setAddDraft({ name: "", scheduledValue: "", openingBilled: "" });
                })
              }
            >
              Add line item
            </Button>
            <Button variant="secondary" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
