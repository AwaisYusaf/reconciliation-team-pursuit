"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type KeyboardEvent } from "react";

import { Button } from "@/src/components/ui/button";
import { ConfirmButton } from "@/src/components/ui/confirm-button";
import { Dialog } from "@/src/components/ui/dialog";
import { Input, Label, MoneyInput } from "@/src/components/ui/field";
import { Modal } from "@/src/components/ui/modal";
import { Card, DangerPanel } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { reportResult } from "@/src/components/ui/toast";
import type { ActionResult } from "@/src/lib/action-result";
import { cn } from "@/src/lib/cn";
import { formatDateUS, todayIso } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { cascadeConfirmation, moveInOrder } from "@/src/domain/line-item-rules";
import { UI } from "@/src/domain/strings";
import {
  addLineItemPerformanceAction,
  deleteLineItemAction,
  deleteLineItemPerformanceAction,
  reorderLineItemsAction,
  saveLineItemAction,
  saveLineItemPerformanceAction,
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

/** A function, not a constant: a module-level `todayIso()` is frozen at first load, so a tab
 *  left open past midnight would prefill yesterday. */
function emptyPerformanceDraft() {
  return { name: "", amount: "", date: todayIso() };
}

// Compact sizing for the Manage popup's performances table. `cn` only joins classes (no
// tailwind-merge), so a plain `py-1` competes with Td/Button/Input's own padding and min-height
// and loses on CSS order — the trailing `!` is what makes these overrides actually apply.
/**
 * The reorder control: one bordered stepper, not two loose glyphs.
 *
 * The halves share a frame and a hairline divider, so the pair reads as a single object the
 * row owns. Two free-floating chevrons with air between them read as debris in the margin —
 * there is nothing to say the two belong together or that either is a button at all.
 *
 * Each half is 18px, so the whole control is 37px in a 40px column. That is under the 44px
 * touch minimum the design system asks for, and deliberately: a table row is not 44px tall, so
 * a target that size would overlap the rows above and below and reorder the wrong line. The
 * control is fully keyboard-operable, which is the path that has to work.
 */
const REORDER_HALF =
  "flex items-center justify-center w-full h-[15px] text-sub transition-colors " +
  "hover:text-surface hover:bg-accent " +
  "disabled:text-disabled disabled:hover:bg-transparent disabled:cursor-not-allowed";

/**
 * A chevron in the plain stroke style the rest of the app's icons use (the settings section
 * icons, the Select's own chevron) — rather than the `▲`/`▼` text glyphs this used to draw,
 * which rendered at whatever weight the font felt like and sat off the vertical centre.
 *
 * The viewBox is cropped to the stroke rather than the app's usual square. A chevron inside
 * `0 0 20 20` only spans the middle quarter of it, so the box carries about 3px of empty space
 * above and below the mark at this size — stacked, that empty space is most of the gap between
 * the two, and no amount of shrinking the buttons closes it.
 */
function ReorderChevron({ up = false }: { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 12 7"
      aria-hidden="true"
      className="w-[11px] h-[6px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={up ? "M1 6 6 1l5 5" : "M1 1 6 6l5-5"} />
    </svg>
  );
}

/**
 * Tighter rows for the line-items table.
 *
 * The row was ~78px tall, and almost none of it was the text: the Manage and Delete buttons are
 * `quiet`, which carries `min-h-11` for touch, and a 44px control inside a 28px-padded cell
 * sets the height of the whole row. So both halves had to move — `DENSE_BUTTON` on the two
 * buttons and this on the cells — because shrinking only the padding would have left the
 * buttons holding the rows open at the same height.
 *
 * Applied on the `tr` rather than on each of the six `Td`s: one place to change, and no chance
 * of a cell being added later that quietly keeps the old padding and re-inflates the row.
 */
const ROW_DENSE = "[&>td]:py-2!";

const DENSE_CELL = "py-1.5!";
const DENSE_CONTROL = "min-h-9! py-1!";
const DENSE_BUTTON = "min-h-8! px-2.5! py-0.5! text-[15px]!";

export function LineItemsManager({
  rows,
  fundingSourceId,
}: {
  rows: LineItemRow[];
  fundingSourceId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [managingId, setManagingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", scheduledValue: "", openingBilled: "" });
  const [newPerformance, setNewPerformance] = useState(emptyPerformanceDraft);
  /** The one performance row currently in Edit mode, with its unsaved values. */
  const [editingPerformance, setEditingPerformance] = useState<{
    id: string;
    name: string;
    date: string;
    amount: string;
  } | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState({ name: "", scheduledValue: "", openingBilled: "" });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<
    ({ id: string; changed?: boolean } & LineItemDeleteConfirmation) | null
  >(null);

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
        setError(result.error ?? "That change couldn't be saved. Try again.");
      }
    });
  }

  function openManage(row: LineItemRow) {
    setManagingId(row.id);
    setError(null);
    setDraft({
      name: row.name,
      scheduledValue: toInput(row.scheduledValueCents),
      openingBilled: toInput(row.openingBilledCents),
    });
    setNewPerformance(emptyPerformanceDraft());
  }

  function closeManage() {
    setManagingId(null);
    setNewPerformance(emptyPerformanceDraft());
    setEditingPerformance(null);
  }

  /** A legacy performance has no name/date yet; they start blank rather than prefilled with
   *  the positional label or today, so saving asks for real values instead of writing a
   *  guess into the database ("never guessed", queries.ts). */
  function startEditPerformance(performance: LineItemRow["performances"][number]) {
    setEditingPerformance({
      id: performance.id,
      name: performance.name ?? "",
      date: performance.date ?? "",
      amount: toInput(performance.amountCents),
    });
  }

  function saveEditedPerformance() {
    if (!editingPerformance) return;
    const values = editingPerformance;
    // Row leaves Edit mode only once the save succeeds, so a refusal keeps the typed values.
    run(
      () => saveLineItemPerformanceAction(values),
      () => setEditingPerformance(null),
      "Performance saved.",
    );
  }

  function move(index: number, delta: number) {
    const next = moveInOrder(rows, index, delta);
    if (next[index] === rows[index]) return;
    setError(null);
    startTransition(async () => {
      const result = await reorderLineItemsAction(next.map((row) => row.id), fundingSourceId);
      // Refreshed either way: on success to show the saved order, and on a refusal because the
      // list on screen is out of date (someone added or deleted a line item), so the fresh list
      // is what the person reorders next rather than the same stale one.
      if (!reportResult(result, "Order updated.")) setError(result.error ?? "That change couldn't be saved. Try again.");
      router.refresh();
    });
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
      () =>
        addLineItemPerformanceAction({
          lineItemId,
          name: newPerformance.name,
          amount: newPerformance.amount,
          date: newPerformance.date,
        }),
      () => setNewPerformance(emptyPerformanceDraft()),
      "Performance added.",
    );
  }

  function removePerformance(id: string) {
    run(() => deleteLineItemPerformanceAction(id), undefined, "Performance deleted.");
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
          label: "Delete line item",
          disabled: pending,
          onConfirm: () => {
            const { id, recurringNames, performanceTotalCents } = confirmDelete!;
            startTransition(async () => {
              setError(null);
              // Sends back exactly what the dialog listed, so the server deletes only that.
              const result = await deleteLineItemAction(id, { recurringNames, performanceTotalCents });
              // Something was added or removed since the dialog opened: show the new list and
              // let the person confirm again, rather than deleting what they never saw.
              if (result.ok && result.data?.requiresConfirmation) {
                setConfirmDelete({ id, changed: true, ...result.data.requiresConfirmation });
                return;
              }
              // Stays open (Delete disabled via `pending`) until the outcome is known, so the
              // dialog doesn't vanish out from under a failure the general error banner is
              // about to show — the dialog would otherwise hide that banner behind its overlay.
              setConfirmDelete(null);
              if (reportResult(result, "Line item deleted.")) router.refresh();
              else setError(result.error ?? "The line item couldn't be deleted. Try again.");
            });
          },
        }}
      >
        {confirmDelete?.changed && <p className="mb-3 font-semibold">{UI.lineItemDeleteChanged}</p>}
        {confirmDelete &&
          cascadeConfirmation(confirmDelete.recurringNames, confirmDelete.performanceTotalCents)}
      </Dialog>

      {/* Edit and Add used to be two separate popups; a single "Manage" now covers the line
          item's own fields and its performances together, since both are edited far less
          often than they're just read from the table (D-92). */}
      {(() => {
        const row = rows.find((r) => r.id === managingId);
        // Always rendered, open while a row is being managed, so the Modal can keep showing the
        // last row while it fades out (the draft and performances live in this component).
        return (
          <Modal open={row !== undefined} title={row ? `Manage ${row.name}` : ""} onClose={closeManage} size="lg">
            {row && (
              <>
              {/* Small uppercase labels, not full SectionTitle headings — matching the compact
                  heading style Settings' own label lists use (settings-sections.tsx) rather
                  than a full card per section, which just made this popup tall for no reason. */}
              <div className="text-[13px] uppercase tracking-[0.06em] text-sub font-bold mb-2">
                Line item
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="manage-name">Line item name</Label>
                  <Input
                    id="manage-name"
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="manage-scheduled">
                    Scheduled value <span className="font-normal text-sub">(base only)</span>
                  </Label>
                  <MoneyInput
                    id="manage-scheduled"
                    value={draft.scheduledValue}
                    onChange={(event) => setDraft({ ...draft, scheduledValue: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="manage-opening">Opening previously billed</Label>
                  <MoneyInput
                    id="manage-opening"
                    value={draft.openingBilled}
                    onChange={(event) => setDraft({ ...draft, openingBilled: event.target.value })}
                  />
                </div>
              </div>

              <div className="text-[13px] uppercase tracking-[0.06em] text-sub font-bold mt-5 mb-2">
                Performances
              </div>
              <TableCard minWidth={560} data-tour="line-items-performances">
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Date</Th>
                    <Th align="right">Amount</Th>
                    <Th align="right" className="w-[160px]" />
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <Td colSpan={2} className={cn("text-sub", DENSE_CELL)}>
                      Base value
                    </Td>
                    <Td align="right" numeric className={DENSE_CELL}>
                      {formatMoney(row.scheduledValueCents)}
                    </Td>
                    <Td className={DENSE_CELL} />
                  </tr>
                  {row.performances.map((performance, index) => {
                    const label = performance.name ?? `Performance ${index + 1}`;
                    const edit =
                      editingPerformance?.id === performance.id ? editingPerformance : null;
                    const saveOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
                      // The Save button is disabled while pending; Enter has to respect that too.
                      if (event.key === "Enter" && !pending) saveEditedPerformance();
                    };
                    return (
                      <tr key={performance.id}>
                        <Td className={DENSE_CELL}>
                          {edit ? (
                            <Input
                              aria-label="Performance name"
                              autoFocus
                              value={edit.name}
                              placeholder="Performance name"
                              onChange={(event) =>
                                setEditingPerformance({ ...edit, name: event.target.value })
                              }
                              onKeyDown={saveOnEnter}
                              className={DENSE_CONTROL}
                            />
                          ) : (
                            label
                          )}
                        </Td>
                        <Td className={cn("text-sub", DENSE_CELL)}>
                          {edit ? (
                            <Input
                              aria-label="Performance date"
                              type="date"
                              value={edit.date}
                              onChange={(event) =>
                                setEditingPerformance({ ...edit, date: event.target.value })
                              }
                              onKeyDown={saveOnEnter}
                              className={DENSE_CONTROL}
                            />
                          ) : performance.date ? (
                            formatDateUS(performance.date)
                          ) : (
                            "-"
                          )}
                        </Td>
                        <Td align="right" numeric className={DENSE_CELL}>
                          {edit && !performance.amountLocked ? (
                            <MoneyInput
                              aria-label="Performance amount"
                              value={edit.amount}
                              onChange={(event) =>
                                setEditingPerformance({ ...edit, amount: event.target.value })
                              }
                              onKeyDown={saveOnEnter}
                              className={DENSE_CONTROL}
                            />
                          ) : (
                            <>
                              {formatMoney(performance.amountCents)}
                              {edit && (
                                <div className="text-[13px] text-sub">
                                  Part of the contract value. To change it, delete it and add it again.
                                </div>
                              )}
                            </>
                          )}
                        </Td>
                        <Td align="right" className={cn("whitespace-nowrap", DENSE_CELL)}>
                          {edit ? (
                            <>
                              <Button
                                className={DENSE_BUTTON}
                                disabled={pending}
                                onClick={saveEditedPerformance}
                              >
                                Save
                              </Button>
                              <Button
                                variant="quiet"
                                className={DENSE_BUTTON}
                                disabled={pending}
                                onClick={() => setEditingPerformance(null)}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="quiet"
                                className={DENSE_BUTTON}
                                disabled={pending}
                                onClick={() => startEditPerformance(performance)}
                              >
                                Edit
                              </Button>
                              <ConfirmButton
                                variant="quiet"
                                className={DENSE_BUTTON}
                                disabled={pending}
                                title={`Delete ${label}?`}
                                body={`${formatMoney(performance.amountCents)} will be removed from ${row.name}'s scheduled value. This can't be undone.`}
                                confirmLabel="Delete performance"
                                onConfirm={() => removePerformance(performance.id)}
                              >
                                Delete
                              </ConfirmButton>
                            </>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                  <tr>
                    <Td colSpan={2} className={cn("font-bold border-t-2 border-ink", DENSE_CELL)}>
                      Total
                    </Td>
                    <Td
                      align="right"
                      numeric
                      className={cn("font-bold border-t-2 border-ink", DENSE_CELL)}
                    >
                      {formatMoney(row.totalScheduledValueCents)}
                    </Td>
                    <Td className={cn("border-t-2 border-ink", DENSE_CELL)} />
                  </tr>
                </tbody>
              </TableCard>

              <div className="flex flex-wrap items-end gap-2.5 mt-3">
                <div className="flex-1 min-w-[160px]">
                  <Input
                    aria-label="New performance name"
                    value={newPerformance.name}
                    placeholder="Performance name"
                    onChange={(event) =>
                      setNewPerformance({ ...newPerformance, name: event.target.value })
                    }
                  />
                </div>
                <div className="w-[165px]">
                  <Input
                    aria-label="New performance date"
                    type="date"
                    value={newPerformance.date}
                    onChange={(event) =>
                      setNewPerformance({ ...newPerformance, date: event.target.value })
                    }
                  />
                </div>
                <div className="w-[110px]">
                  <MoneyInput
                    aria-label="New performance amount"
                    value={newPerformance.amount}
                    placeholder="0.00"
                    onChange={(event) =>
                      setNewPerformance({ ...newPerformance, amount: event.target.value })
                    }
                  />
                </div>
                <Button
                  className="min-h-9 px-3.5 text-[15px]"
                  disabled={pending}
                  onClick={() => addPerformance(row.id)}
                >
                  Add
                </Button>
              </div>

              <div className="flex justify-end mt-5 pt-4 border-t border-line">
                <Button
                  variant="secondary"
                  className="min-h-9 px-3.5 text-[15px]"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => saveLineItemAction({ id: row.id, fundingSourceId, ...draft }),
                      undefined,
                      "Line item saved.",
                    )
                  }
                >
                  Save line item
                </Button>
              </div>
              </>
            )}
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
            <Th align="right" className="w-[160px]">
              Actions
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            // The shared cell padding is sized for tables whose cells hold wrapping text. Every
            // cell in this one holds a single short line, so the default `py-3.5` was padding
            // around nothing — see `ROW_DENSE`.
            <tr key={row.id} className={ROW_DENSE}>
              <Td className="pl-4 pr-2 text-sub select-none">
                <div
                  className="w-[26px] rounded-[6px] border border-line bg-surface overflow-hidden divide-y divide-line"
                  data-tour="line-items-reorder"
                >
                  <button
                    type="button"
                    aria-label={`Move ${row.name} up`}
                    disabled={pending || index === 0}
                    onClick={() => move(index, -1)}
                    className={REORDER_HALF}
                  >
                    <ReorderChevron up />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${row.name} down`}
                    disabled={pending || index === rows.length - 1}
                    onClick={() => move(index, 1)}
                    className={REORDER_HALF}
                  >
                    <ReorderChevron />
                  </button>
                </div>
              </Td>
              <Td>{row.name}</Td>
              <Td align="right" numeric>
                {formatMoney(row.totalScheduledValueCents)}
              </Td>
              <Td align="right" numeric className="text-sub">
                {performanceTotal(row) > 0 ? formatMoney(performanceTotal(row)) : "-"}
              </Td>
              <Td align="right" numeric>
                {formatMoney(row.openingBilledCents)}
              </Td>
              <Td align="right">
                <div className="flex gap-4 justify-end">
                  <Button
                    variant="quiet"
                    className={DENSE_BUTTON}
                    onClick={() => openManage(row)}
                    disabled={pending}
                    data-tour="line-items-manage"
                  >
                    Manage
                  </Button>
                  <Button
                    variant="quiet"
                    className={DENSE_BUTTON}
                    onClick={() => remove(row)}
                    disabled={pending}
                  >
                    Delete
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
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
                Amount already billed before you started using this app.
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mt-[22px]">
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () => saveLineItemAction({ fundingSourceId, ...addDraft }),
                  () => {
                    setShowAdd(false);
                    setAddDraft({ name: "", scheduledValue: "", openingBilled: "" });
                  },
                  "Line item added.",
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
