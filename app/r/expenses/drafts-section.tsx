"use client";

/**
 * "Waiting for review" — the drafts an invoice upload created, above the normal expenses
 * table (Phase 14 §5). Renders nothing when there are no drafts in scope.
 *
 * Shown in place of the expenses table, never above it: the two carry different columns and
 * different actions, and stacking them made the screen read as two lists competing for the
 * same attention. `ExpensesView` owns which one is on screen; this component only renders the
 * drafts themselves, and nothing at all when there are none.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";
import { Menu, MenuItem, MenuLink } from "@/src/components/ui/menu";
import { Subtext } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatDateUS, todayIso } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { draftIsReady, draftNeeds } from "@/src/domain/draft-rules";
import { UI } from "@/src/domain/strings";
import {
  approveDraftAction,
  approveReadyDraftsAction,
  discardDraftAction,
  undoDiscardAction,
} from "@/src/modules/expense-imports/draft-actions";
import type { DraftRow } from "@/src/modules/expense-imports/queries";
import { reportResult, toast, toastWithAction } from "@/src/components/ui/toast";

export type DraftSectionRow = Omit<DraftRow, "lineItemName"> & {
  lineItemName: string | null;
  fundingSourceName: string;
};

export function DraftsSection({
  rows,
  month,
  fundingSourceId,
  multiSource,
}: {
  rows: DraftSectionRow[];
  month: string;
  fundingSourceId: string | null;
  multiSource: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** The draft the confirmation dialog is asking about, by id and name. */
  const [confirmDiscard, setConfirmDiscard] = useState<{ id: string; name: string } | null>(null);

  if (rows.length === 0) return null;

  const readyCount = rows.filter(draftIsReady).length;

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-bold">{UI.draftsWaitingHeading(rows.length)}</h2>
        {/* The reason is rendered as text, never as a `title` on the disabled button: a
            disabled button fires no pointer events, so that tooltip never opens, and it is not
            focusable either, so a keyboard or screen reader never reaches it. The one place
            the screen explained itself was the one place nobody could read. */}
        {readyCount === 0 ? (
          <Subtext>{UI.draftsNoneReady}</Subtext>
        ) : (
          <Button
            // The work this screen exists for, so it leads. The way back out is the quiet one.
            className="min-h-11 px-4 text-[15px]"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await approveReadyDraftsAction({ month, fundingSourceId });
                if (result.ok) {
                  toast.success(result.data.message);
                  router.refresh();
                } else {
                  reportResult(result);
                }
              })
            }
          >
            {UI.draftApproveAllReady(readyCount)}
          </Button>
        )}
      </div>

      {/* Same density as the expenses table below it, so the two read as one list. */}
      <TableCard dense minWidth={multiSource ? 1060 : 960}>
        <thead>
          <tr>
            <Th sticky>Date</Th>
            <Th>Name</Th>
            <Th>Line item</Th>
            {multiSource && <Th>Funding source</Th>}
            <Th>Payment source</Th>
            <Th align="right">Amount</Th>
            {/* Proof/Receipt/Supporting/Narrative are left out on purpose. A draft can hold
                files of its own (`expense_draft_documents`), but it is in no packet and no
                gate until it is approved, so the red MISSING those cells show for a real
                expense would name a blocker that does not exist yet — and "Still needs"
                already says what does. */}
            <Th>Still needs</Th>
            <Th align="right" stickyEnd />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const ready = draftIsReady(row);
            const needs = draftNeeds(row).join(" · ");
            return (
              <tr key={row.id}>
                <Td sticky className="whitespace-nowrap">
                  <span className="text-sm text-sub uppercase">{UI.draftMark}</span>
                  <span className="block tabular-nums">{formatDateUS(row.date)}</span>
                </Td>
                <Td>
                  {/* The row's own way in. Editing is what someone does with almost every
                      draft, and burying it under a kebab made the common action the slowest
                      one. A real link, not a row click handler: it keyboard-focuses, opens in
                      a new tab on middle click, and shows its target on hover. Edit stays in
                      the menu too, for anyone already there. */}
                  <Link
                    href={`/r/expenses/drafts/${row.id}/edit`}
                    className="underline decoration-line underline-offset-2 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent rounded-[2px]"
                  >
                    {row.name}
                  </Link>
                  {/*
                    Who last saved it, under the name rather than in a column of its own. This
                    table already has eight columns and the value repeats for every draft from
                    the same import, so as a column it would be width spent on one repeated
                    name. Under the name it is context for the row someone is about to open:
                    two people review the same invoice, and the question before picking a
                    draft up is whether the other one is already in it.

                    Silent when no actor was recorded — a draft written before the column
                    existed, or one whose author's account has been removed.
                  */}
                  {row.lastSavedBy && (
                    <span className="block text-[13px] text-sub">
                      {UI.draftLastSavedBy(row.lastSavedBy, formatDateUS(todayIso(row.lastSavedAt)))}
                    </span>
                  )}
                </Td>
                <Td>{row.lineItemName ?? "-"}</Td>
                {multiSource && (
                  // Same cap as the expenses table, so the two lists line up.
                  <Td className="text-[15px] text-sub leading-snug">
                    <span className="block max-w-[132px] truncate" title={row.fundingSourceName}>
                      {row.fundingSourceName}
                    </span>
                  </Td>
                )}
                <Td className="text-[15px] text-sub leading-snug">{row.paymentSource}</Td>
                <Td align="right" numeric>
                  {formatMoney(row.reimbursableCents)}
                </Td>
                <Td className="text-sub">{needs || "-"}</Td>
                <Td align="right" stickyEnd className="whitespace-nowrap">
                  <div className="flex justify-end items-center gap-2">
                    {ready && (
                      <Button
                        variant="secondary"
                        className="min-h-9 px-3 py-1.5 text-[15px]"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            if (reportResult(await approveDraftAction(row.id))) router.refresh();
                          })
                        }
                      >
                        {UI.draftApprove}
                      </Button>
                    )}
                    <Menu
                      label={`Actions for ${row.name}`}
                      triggerClassName="px-2 py-2.5 text-lg leading-none text-sub hover:text-ink rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <MenuLink href={`/r/expenses/drafts/${row.id}/edit`}>
                        {UI.draftEdit}
                      </MenuLink>
                      <MenuItem
                        // Asks first: this sits one line under Edit in the same menu, it
                        // destroys the files attached to the draft for good, and Undo brings
                        // the row back without them. The repo's rule is that an action which
                        // destroys stored data confirms before it runs.
                        onClick={() => setConfirmDiscard({ id: row.id, name: row.name })}
                      >
                        {UI.draftDiscard}
                      </MenuItem>
                    </Menu>
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableCard>

      <Dialog
        open={confirmDiscard !== null}
        title={UI.draftDiscardTitle}
        dismissLabel={UI.draftDiscardKeep}
        onDismiss={() => setConfirmDiscard(null)}
        confirm={{
          label: UI.draftDiscard,
          onConfirm: () => {
            const target = confirmDiscard;
            setConfirmDiscard(null);
            if (!target) return;
                          startTransition(async () => {
                            const result = await discardDraftAction(target.id);
                            if (!result.ok) {
                              reportResult(result);
                              return;
                            }
                            router.refresh();
                            const discarded = result.data;
                            // Named separately because Undo cannot bring the files back:
                            // they were deleted with the draft (see `discardDraftAction`).
                            toastWithAction(
                              discarded.removedFileCount > 0
                                ? UI.draftDiscardedWithFiles
                                : UI.draftDiscarded,
                              {
                              label: UI.draftUndo,
                              onAction: () =>
                                startTransition(async () => {
                                  if (reportResult(await undoDiscardAction(discarded))) {
                                    router.refresh();
                                  }
                                }),
                              },
                            );
            });
          },
        }}
      >
        {confirmDiscard && UI.draftDiscardBody(confirmDiscard.name)}
      </Dialog>
    </div>
  );
}
