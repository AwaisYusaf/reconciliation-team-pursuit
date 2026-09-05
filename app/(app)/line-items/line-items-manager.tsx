"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";
import { Input, Label, MoneyInput } from "@/src/components/ui/field";
import { Modal } from "@/src/components/ui/modal";
import { Card, DangerPanel } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { reportResult } from "@/src/components/ui/toast";
import type { ActionResult } from "@/src/lib/action-result";
import { formatMoney } from "@/src/domain/format";
import { cascadeConfirmation, moveInOrder } from "@/src/domain/line-item-rules";
import {
  addLineItemPerformanceAction,
  deleteLineItemAction,
  deleteLineItemPerformanceAction,
  reorderLineItemsAction,
  saveLineItemAction,
  type LineItemDeleteConfirmation,
} from "@/src/modules/line-items/actions";
import type { LineItemRow } from "@/src/modules/line-items/queries";

/** Cents → the editable string form, so an edit round-trips without reformatting surprises. */
function toInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Sum of a line item's performances (m08) — 0 for a line item with none. */
function performanceTotal(row: LineItemRow): number {
  return row.performances.reduce((sum, performance) => sum + performance.amountCents, 0);
}

export function LineItemsManager({ rows }: { rows: LineItemRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", scheduledValue: "", openingBilled: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState({ name: "", scheduledValue: "", openingBilled: "" });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<
    ({ id: string } & LineItemDeleteConfirmation) | null
  >(null);
  const [performanceRowId, setPerformanceRowId] = useState<string | null>(null);
  const [newPerformance, setNewPerformance] = useState("");

  function run(
    work: () => Promise<ActionResult<unknown>>,
    onDone?: () => void,
    successMessage?: string,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (reportResult(result, successMessage)) {
        onDone?.();
        router.refresh();
      } else {
        // Kept inline as well: a refusal explains a rule and should stay on screen.
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
    run(() => reorderLineItemsAction(next.map((row) => row.id)), undefined, "Order updated");
  }

  function remove(row: LineItemRow) {
    startTransition(async () => {
      setError(null);
      const result = await deleteLineItemAction(row.id, false);
      if (!result.ok) {
        setError(result.error);
        reportResult(result);
        return;
      }
      // The server always asks first (R9.3); the list it returns may be empty, which is why
      // this tests for presence rather than length.
      if (result.data?.requiresConfirmation) {
        setConfirmDelete({ id: row.id, ...result.data.requiresConfirmation });
        return;
      }
      router.refresh();
    });
  }

  function addPerformance(lineItemId: string) {
    run(
      () => addLineItemPerformanceAction(lineItemId, newPerformance),
      () => setNewPerformance(""),
      "Performance added",
    );
  }

  function removePerformance(id: string) {
    run(() => deleteLineItemPerformanceAction(id), undefined, "Performance removed");
  }

  return (
    <div>
      {error && (
        <DangerPanel tone="notice" className="mb-4">
          {error}
        </DangerPanel>
      )}

      <Dialog
        open={confirmDelete !== null}
        title="Delete this line item?"
        dismissLabel="Cancel"
        onDismiss={() => setConfirmDelete(null)}
        confirm={{
          label: "Delete anyway",
          disabled: pending,
          onConfirm: () => {
            const id = confirmDelete!.id;
            startTransition(async () => {
              setError(null);
              const result = await deleteLineItemAction(id, true);
              // Stays open (Delete disabled via `pending`) until the outcome is known, so the
              // dialog doesn't vanish out from under a failure the general error banner is
              // about to show — the dialog would otherwise hide that banner behind its overlay.
              setConfirmDelete(null);
              if (reportResult(result, "Line item deleted")) router.refresh();
              else setError(result.error ?? "Something went wrong.");
            });
          },
        }}
      >
        {confirmDelete &&
          cascadeConfirmation(confirmDelete.recurringNames, confirmDelete.performanceTotalCents)}
      </Dialog>

      {(() => {
        const row = rows.find((r) => r.id === performanceRowId);
        if (!row) return null;
        return (
          <Modal
            open
            title={`${row.name} — Performances`}
            onClose={() => {
              setPerformanceRowId(null);
              setNewPerformance("");
            }}
          >
            <div className="flex justify-between py-1.5 text-[15px]">
              <span className="text-sub">Base value</span>
              <span>{formatMoney(row.scheduledValueCents)}</span>
            </div>
            {row.performances.map((performance, index) => (
              <div key={performance.id} className="flex justify-between items-center py-1.5 text-[15px]">
                <span className="text-sub">Performance {index + 1}</span>
                <div className="flex items-center gap-3">
                  <span>{formatMoney(performance.amountCents)}</span>
                  <Button
                    variant="quiet"
                    disabled={pending}
                    onClick={() => removePerformance(performance.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex justify-between py-1.5 text-[15px] font-bold border-t border-line mt-1 pt-2.5">
              <span>Total</span>
              <span>{formatMoney(row.totalScheduledValueCents)}</span>
            </div>

            <div className="flex flex-wrap gap-3 items-end mt-[18px]">
              <div className="flex-1 min-w-[160px]">
                <Label htmlFor="new-performance">Add performance</Label>
                <MoneyInput
                  id="new-performance"
                  value={newPerformance}
                  placeholder="0.00"
                  onChange={(event) => setNewPerformance(event.target.value)}
                />
              </div>
              <Button disabled={pending} onClick={() => addPerformance(row.id)}>
                Add performance
              </Button>
            </div>
          </Modal>
        );
      })()}

      <TableCard minWidth={900}>
        <thead>
          <tr>
            <Th className="w-10" aria-label="Reorder" />
            <Th>Line Item Name</Th>
            <Th align="right">Scheduled Value</Th>
            <Th align="right">Performances</Th>
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
                    <Td align="right" className="py-3 text-sub" numeric>
                      {/* Not editable here — performances are added/removed from the "Add" popup. */}
                      {performanceTotal(row) > 0 ? formatMoney(performanceTotal(row)) : "—"}
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
                            run(
                              () => saveLineItemAction({ id: row.id, ...draft }),
                              () => setEditingId(null),
                              "Line item saved",
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
                      {formatMoney(row.totalScheduledValueCents)}
                    </Td>
                    <Td align="right" numeric className="text-sub">
                      {performanceTotal(row) > 0 ? formatMoney(performanceTotal(row)) : "—"}
                    </Td>
                    <Td align="right" numeric>
                      {formatMoney(row.openingBilledCents)}
                    </Td>
                    <Td align="right">
                      <div className="flex gap-4 justify-end">
                        <Button variant="quiet" onClick={() => startEdit(row)} disabled={pending}>
                          Edit
                        </Button>
                        <Button
                          variant="quiet"
                          onClick={() => setPerformanceRowId(row.id)}
                          disabled={pending}
                        >
                          Add
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
                run(
                  () => saveLineItemAction(addDraft),
                  () => {
                    setShowAdd(false);
                    setAddDraft({ name: "", scheduledValue: "", openingBilled: "" });
                  },
                  "Line item added",
                )
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
