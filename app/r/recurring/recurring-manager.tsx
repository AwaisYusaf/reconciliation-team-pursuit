"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { ConfirmButton } from "@/src/components/ui/confirm-button";
import { Dialog } from "@/src/components/ui/dialog";
import { Helper, Input, Label, MoneyInput, Textarea } from "@/src/components/ui/field";
import { Select } from "@/src/components/ui/select";
import { Card, DangerPanel, EmptyState } from "@/src/components/ui/surfaces";
import { cn } from "@/src/lib/cn";
import { TableCard, Td, Th, Tr } from "@/src/components/ui/table";
import { reportResult, toastWithAction } from "@/src/components/ui/toast";
import type { ActionResult } from "@/src/lib/action-result";
import { formatMoney, formatMoneyInput } from "@/src/domain/format";
import {
  ALL_LINE_ITEMS,
  matchesRecurringFilters,
  recurringPaymentSource,
  removeConfirmation,
} from "@/src/domain/recurring-rules";
import { UI } from "@/src/domain/strings";
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
  fundingSourceName: string;
  /** This row's own source — the lock key `"{fundingSourceId}:{month}"` (D-96). */
  fundingSourceId: string;
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

/**
 * Rows per page. Pagination only appears above this, so the client's current list — a couple
 * of dozen vendors and salaries — stays a single uninterrupted table.
 */
const PAGE_SIZE = 25;

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
  multiSource,
  lockedMonths,
}: {
  rows: RecurringRow[];
  /** `label` is what the picker shows (source-qualified when the org has several sources);
   *  `name` is the bare line item name the filters match on. */
  lineItems: Array<{ id: string; name: string; label: string }>;
  paymentSources: string[];
  month: string;
  monthLabel: string;
  monthShort: string;
  /** True when the org has more than one funding source; shows the Funding Source column. */
  multiSource: boolean;
  /** Every locked `"{fundingSourceId}:{month}"` in the org (Appendix A §2, D-96). */
  lockedMonths: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const lockedMonthKeys = useMemo(() => new Set(lockedMonths), [lockedMonths]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** The add/edit form's own refusal, shown in the form (PR #27): the page panel is above the
   *  list, far from a form under a row. Tied to the draft it was for, so typing (a new draft
   *  object) or opening another item clears it. */
  const [formError, setFormError] = useState<{ draft: Draft; message: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ row: RecurringRow; message: string } | null>(
    null,
  );
  const [justChanged, setJustChanged] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lineFilter, setLineFilter] = useState(ALL_LINE_ITEMS);
  const [page, setPage] = useState(1);

  // Only line items that actually have a recurring item, matching the expenses list. Offering
  // every line item would let the reader pick one that can only ever show an empty table.
  const lineItemNames = useMemo(
    () => [...new Set(rows.map((row) => row.lineItemName))].sort(),
    [rows],
  );

  const visible = useMemo(
    () => rows.filter((row) => matchesRecurringFilters(row, { query, lineFilter })),
    [rows, query, lineFilter],
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // Clamped at render rather than tracked in an effect, so deleting the last row on the last
  // page falls back to a page that exists instead of showing an empty table.
  const safePage = Math.min(page, pageCount);
  const shown = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Whether the row being edited is on the current page/filter, so the edit form can sit
  // inline under it. If a filter change hides that row mid-edit, the form falls back to the
  // bottom of the page (below) rather than disappearing entirely.
  const editingRowVisible = Boolean(draft?.id && shown.some((row) => row.id === draft.id));

  /** Narrowing the list can strand the reader past the end, so any filter change goes to page 1. */
  function refine(apply: () => void) {
    apply();
    setPage(1);
  }

  /**
   * Clear the controls when a saved item would land outside them.
   *
   * Adding "Acme" while the search reads "Zephyr" saves it into a list that cannot show it,
   * which reads as a save that failed — as does editing a row into a line item the current
   * filter excludes. Only clears when the row would actually be hidden, so working through a
   * filtered list is not interrupted by every save.
   */
  function revealSaved(saved: Draft) {
    const lineItemName = lineItems.find((item) => item.id === saved.lineItemId)?.name ?? "";
    const matches = matchesRecurringFilters(
      { name: saved.name, defaultDescription: saved.defaultDescription, lineItemName },
      { query, lineFilter },
    );

    if (!matches) {
      setQuery("");
      setLineFilter(ALL_LINE_ITEMS);
      setPage(1);
    }
  }

  function run(
    work: () => Promise<ActionResult<unknown>>,
    onDone?: () => void,
    successMessage?: string,
    showError: (message: string | null) => void = setError,
  ) {
    setError(null);
    showError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        // Inline only; a toast of the same words was a second copy (PR #27).
        showError(result.error ?? "That change couldn't be saved. Try again.");
        return;
      }
      reportResult(result, successMessage);
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
    setError(null);
    startTransition(async () => {
      const result = await addRecurringToMonthAction(row.id, month);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The flash confirms the add, so it must wait for the add to succeed. It used to fire
      // first, which meant a failed add still went green — exactly how a live insert failure
      // stayed invisible on this screen (TASKS.md U2).
      flash(row.id);
      // Says what the new expense still needs and opens it (#44); it starts incomplete on
      // purpose (R4.5), so only the message changes.
      toastWithAction(UI.recurringAdded(row.name, monthLabel, result.data.missing), {
        label: UI.openExpense,
        onAction: () => router.push(`/r/expenses/${result.data.id}/edit`),
      });
      router.refresh();
    });
  }

  function remove(row: RecurringRow) {
    setError(null);
    startTransition(async () => {
      const result = await removeRecurringFromMonthAction(row.id, month, false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Only ever reachable for an expense this recurring item actually created — one that
      // merely shares a name is refused outright by the action itself, no confirmation
      // offered, so `error` above is what the user sees for that case instead.
      if (result.data?.requiresConfirmation) {
        setConfirmRemove({
          row,
          message: removeConfirmation(row.name, Number(result.data.requiresConfirmation)),
        });
        return;
      }
      flash(row.id);
      router.refresh();
    });
  }

  /**
   * The add/edit form. Rendered inline under the row being edited so a click on "Edit" doesn't
   * require scrolling to the bottom of the page to find it; the "+ Add recurring item" flow
   * still renders it below the table, where there is no row to sit under.
   */
  /**
   * Edit, and either "Add to {month}" or the added marker with Remove.
   *
   * Extracted because the same controls render twice: in the table's last column on a desktop
   * and inside each card in the phone list. Written out in both places they would quietly
   * diverge the first time either changed.
   */
  function rowActions(row: RecurringRow, rowLocked: boolean) {
    return (
      <div className="flex flex-col items-end gap-1">
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
                amount: formatMoneyInput(row.amountCents),
                lineItemId: row.lineItemId,
                defaultDescription: row.defaultDescription,
              })
            }
          >
            Edit
          </Button>

          {row.added ? (
            <div className="flex items-center gap-3.5" data-tour="recurring-added-item">
              <span className="text-sm font-bold text-success whitespace-nowrap">
                ✓ Added to {monthLabel}
              </span>
              <Button
                variant="quiet"
                className="min-h-9"
                disabled={pending || rowLocked}
                onClick={() => remove(row)}
              >
                Remove
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              // `min-h-9`, matching Remove beside it. At `min-h-11` this button was 44px inside
              // a cell padded to 24px, so it — not the text — set the height of every row in
              // the table.
              className="min-h-9 px-4 text-[15px] whitespace-nowrap"
              disabled={pending || rowLocked}
              onClick={() => add(row)}
              data-tour="recurring-add-to-month"
            >
              Add to {monthShort}
            </Button>
          )}
        </div>
        {rowLocked && <span className="text-xs text-sub">{UI.monthLocked(monthLabel)}</span>}
      </div>
    );
  }

  /**
   * `idPrefix` exists because this form is mounted more than once at a time.
   *
   * The phone card list and the desktop table both render it for the row being edited, and
   * only CSS decides which of the two is displayed — the other is still in the document. With
   * one fixed set of ids that put two `id="rec-name"`, two `id="rec-amount"` and so on onto
   * the page, so every `htmlFor` and `aria-labelledby` resolved to whichever copy came first,
   * which on a desktop is the hidden phone one. Clicking "Name" focused nothing visible, and a
   * screen reader read the labels onto inputs nobody could see.
   */
  function showFormError(currentDraft: Draft) {
    return (message: string | null) => setFormError(message ? { draft: currentDraft, message } : null);
  }

  function renderDraftForm(currentDraft: Draft, idPrefix: string) {
    const fieldId = (name: string) => `${idPrefix}-${name}`;
    return (
      <Card className="p-6 max-w-[860px]">
        {/* Locked while saving: the refusal is shown for the draft that was sent, so typing or
            Cancel mid-request must not swap it for another (PR #27). `contents` keeps the
            card's own layout. */}
        <fieldset disabled={pending} className="contents">
        <div className="flex flex-wrap gap-4">
          <div className="flex-[2] min-w-[220px]">
            <Label htmlFor={fieldId("name")}>Name</Label>
            <Input
              id={fieldId("name")}
              value={currentDraft.name}
              onChange={(event) => setDraft({ ...currentDraft, name: event.target.value })}
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <Label htmlFor={fieldId("amount")}>Amount</Label>
            <MoneyInput
              id={fieldId("amount")}
              value={currentDraft.amount}
              placeholder="0.00"
              onChange={(event) => setDraft({ ...currentDraft, amount: event.target.value })}
            />
          </div>
          <div className="flex-[2] min-w-[220px]">
            <Label id={fieldId("line-label")} htmlFor={fieldId("line")}>Line item</Label>
            <Select
              id={fieldId("line")}
              aria-labelledby={fieldId("line-label")}
              value={currentDraft.lineItemId}
              onValueChange={(value) => setDraft({ ...currentDraft, lineItemId: value })}
            >
              <option value="">Choose a line item</option>
              {lineItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-[18px]">
          <Label htmlFor={fieldId("desc")}>
            Default description <span className="font-normal text-sub">(optional)</span>
          </Label>
          <Input
            id={fieldId("desc")}
            value={currentDraft.defaultDescription}
            onChange={(event) =>
              setDraft({ ...currentDraft, defaultDescription: event.target.value })
            }
          />
          <Helper>
            Becomes the expense&apos;s description, which prints on the cover sheet, when this
            item is added to a month.
          </Helper>
        </div>

        <div className="mt-[18px]">
          <Label htmlFor={fieldId("narrative")}>
            Default narrative <span className="font-normal text-sub">(optional)</span>
          </Label>
          <Textarea
            id={fieldId("narrative")}
            rows={3}
            value={currentDraft.defaultNarrative}
            onChange={(event) =>
              setDraft({ ...currentDraft, defaultNarrative: event.target.value })
            }
          />
          <Helper>
            Fills in automatically each month and stays editable. Correcting it on the expense
            updates this, so next month starts from the current wording.
          </Helper>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-[18px]">
          <div>
            <Label id={fieldId("source-label")} htmlFor={fieldId("source")}>
              Payment source <span className="font-normal text-sub">(optional)</span>
            </Label>
            <Select
              id={fieldId("source")}
              aria-labelledby={fieldId("source-label")}
              value={currentDraft.defaultPaymentSource}
              onValueChange={(value) =>
                setDraft({ ...currentDraft, defaultPaymentSource: value })
              }
            >
              <option value="">Use the default</option>
              {paymentSources.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </Select>
            {currentDraft.defaultPaymentSource === "" && (
              <Helper>The default is {recurringPaymentSource(null, paymentSources)}.</Helper>
            )}
          </div>
          <div>
            <Label htmlFor={fieldId("tax")}>
              Tax <span className="font-normal text-sub">(optional)</span>
            </Label>
            <MoneyInput
              id={fieldId("tax")}
              placeholder="0.00"
              value={currentDraft.defaultTax}
              onChange={(event) => setDraft({ ...currentDraft, defaultTax: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={fieldId("fees")}>
              Fees <span className="font-normal text-sub">(optional)</span>
            </Label>
            <MoneyInput
              id={fieldId("fees")}
              placeholder="0.00"
              value={currentDraft.defaultFees}
              onChange={(event) => setDraft({ ...currentDraft, defaultFees: event.target.value })}
            />
          </div>
        </div>

        {formError?.draft === currentDraft && (
          <DangerPanel tone="notice" className="mt-5">
            {formError.message}
          </DangerPanel>
        )}
        <div className="flex flex-wrap gap-3 mt-5">
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () => saveRecurringItemAction(currentDraft),
                () => {
                  setDraft(null);
                  revealSaved(currentDraft);
                },
                currentDraft.id ? "Recurring item saved." : "Recurring item added.",
                showFormError(currentDraft),
              )
            }
          >
            {currentDraft.id ? "Save changes" : "Add recurring item"}
          </Button>
          <Button variant="secondary" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          {currentDraft.id && (
            <ConfirmButton
              variant="quiet"
              disabled={pending}
              title="Delete this recurring item?"
              confirmLabel="Delete from list"
              body={
                <>
                  <strong>{currentDraft.name || "This item"}</strong> is removed from the
                  recurring list, along with its saved amount and defaults. Expenses already
                  added to a month are left untouched.
                </>
              }
              onConfirm={() =>
                run(
                  () => deleteRecurringItemAction(currentDraft.id!),
                  () => setDraft(null),
                  "Recurring item deleted.",
                  showFormError(currentDraft),
                )
              }
            >
              Delete from list
            </ConfirmButton>
          )}
        </div>
        {currentDraft.id && (
          <Helper>Deleting the list entry leaves any expenses already added untouched.</Helper>
        )}
        </fieldset>
      </Card>
    );
  }

  return (
    <div>
      {error && (
        <DangerPanel key={error} tone="notice" className="mb-4" reveal>
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
              if (result.ok) {
                reportResult(result, "Removed from this month.");
                router.refresh();
              } else setError(result.error ?? "That expense couldn't be removed from this month. Try again.");
            });
          },
        }}
      >
        {confirmRemove?.message}
      </Dialog>

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-[18px] mb-5">
          <div className="flex-1 min-w-[240px] max-w-[340px]">
            <Label id="recurringSearch-label" htmlFor="recurringSearch">Search</Label>
            <Input
              id="recurringSearch"
              type="search"
              aria-labelledby="recurringSearch-label"
              placeholder="Name or description"
              value={query}
              onChange={(event) => refine(() => setQuery(event.target.value))}
            />
          </div>
          <div className="flex-1 min-w-[240px] max-w-[340px]">
            <Label id="recurringLineFilter-label" htmlFor="recurringLineFilter">
              Filter by line item
            </Label>
            <Select
              id="recurringLineFilter"
              aria-labelledby="recurringLineFilter-label"
              value={lineFilter}
              onValueChange={(value) => refine(() => setLineFilter(value))}
            >
              <option>{ALL_LINE_ITEMS}</option>
              {lineItemNames.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </Select>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState>
          No recurring items yet. Add the vendors and salaries that repeat every month.
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>
          No recurring items match this search. Clear the search or the line item filter to see
          the rest.
        </EmptyState>
      ) : (
        <>
        {/*
          A phone gets the same rows stacked, not the table scrolled sideways. Five columns
          plus an actions cell holding Edit and "Add to Jun" need about 860px, so on a 390px
          screen the table showed the name and half of the amount with everything that can be
          done to the row off the right edge.
        */}
        <Card className="lg:hidden divide-y divide-line">
          {shown.map((row) => {
            const rowLocked = lockedMonthKeys.has(`${row.fundingSourceId}:${month}`);
            return (
              <div
                key={row.id}
                className={cn("px-4 py-3.5", justChanged === row.id && "bg-success-bg")}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-bold text-[15px] text-ink min-w-0 break-words">
                    {row.name}
                  </span>
                  <span className="tabular-nums font-bold text-[15px] text-ink shrink-0">
                    {formatMoney(row.amountCents)}
                  </span>
                </div>
                <div className="text-[13px] text-sub mt-0.5">
                  {row.lineItemName}
                  {multiSource ? ` · ${row.fundingSourceName}` : ""}
                </div>
                <div className="mt-2.5">{rowActions(row, rowLocked)}</div>
                {draft?.id === row.id && (
                  <div className="mt-3">{renderDraftForm(draft, "rec-card")}</div>
                )}
              </div>
            );
          })}
        </Card>

        <TableCard minWidth={860} className="hidden lg:block">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th align="right" className="w-[150px]">
                Amount
              </Th>
              <Th>Line item</Th>
              {multiSource && <Th>Funding source</Th>}
              <Th align="right" className="w-[320px]" />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const rowLocked = lockedMonthKeys.has(`${row.fundingSourceId}:${month}`);
              return (
              <Fragment key={row.id}>
              <Tr tone={justChanged === row.id ? "success" : undefined}>
                <Td>{row.name}</Td>
                <Td align="right" numeric>
                  {formatMoney(row.amountCents)}
                </Td>
                <Td>{row.lineItemName}</Td>
                {multiSource && <Td className="text-[15px] text-sub leading-snug">{row.fundingSourceName}</Td>}
                <Td align="right">
                  {rowActions(row, rowLocked)}
                </Td>
              </Tr>
              {draft?.id === row.id && (
                <tr>
                  <td colSpan={multiSource ? 5 : 4} className="p-0 border-b border-line">
                    <div className="p-4 sm:p-6">{renderDraftForm(draft, "rec-row")}</div>
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </TableCard>
        </>
      )}

      {visible.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-4 mt-4 flex-wrap">
          <span className="text-sm text-sub">
            Showing {(safePage - 1) * PAGE_SIZE + 1} to {Math.min(safePage * PAGE_SIZE, visible.length)}{" "}
            of {visible.length}
          </span>
          <div className="flex items-center gap-3.5">
            <Button
              variant="quiet"
              className="min-h-9"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-sub whitespace-nowrap">
              Page {safePage} of {pageCount}
            </span>
            <Button
              variant="quiet"
              className="min-h-9"
              disabled={safePage >= pageCount}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {!draft ? (
        <div className="mt-6">
          <Button
            variant="secondary"
            onClick={() => setDraft({ ...EMPTY_DRAFT })}
            data-tour="recurring-add-item"
          >
            + Add recurring item
          </Button>
        </div>
      ) : editingRowVisible ? null : (
        <div className="mt-8">{renderDraftForm(draft, "rec-new")}</div>
      )}
    </div>
  );
}
