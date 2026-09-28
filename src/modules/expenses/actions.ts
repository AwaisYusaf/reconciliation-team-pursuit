"use server";

/**
 * Expense capture (m02) — the single point where the packet's raw material is recorded.
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import {
  expenseAuditEvents,
  expenseDocuments,
  expenses,
  fundingSources,
  lineItems,
  vendorDefaults,
  type ExpenseAuditSnapshot,
} from "@/src/db/schema";
import { monthLabel } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession, requireAdmin } from "@/src/lib/action-session";
import { requireOwnedFundingSource } from "@/src/modules/funding-sources/queries";
import { monthLocked, type MonthRef } from "@/src/modules/packet/month-guard";
import { carryNarrativeToTemplate } from "@/src/modules/recurring/narrative";
import { claimReferenceSeq } from "./references";
import { loadOrgAuditHistory, type OrgAuditEvent } from "./queries";
import { deleteStoredObjects } from "@/src/services/storage/documents";
import { isUuid } from "@/src/lib/ids";
import { isKnownPaymentSource } from "@/src/modules/settings/labels";

import {
  EXPENSE_SNAPSHOT_COLUMNS,
  insertDeletedAudit,
  insertExpenseWithAudit,
  learnVendor,
  snapshotOf,
  toRow,
} from "./expense-row";
import { validate } from "./validation";

export type ExpenseInput = {
  id?: string;
  name: string;
  fundingSourceId: string;
  lineItemId: string;
  paymentSource: string;
  /** Which parts of the receipt this funder reimburses (R1.3); defaults come from the source. */
  taxReimbursable: boolean;
  feesReimbursable: boolean;
  month: string;
  date: string;
  description: string;
  subtotal: string;
  tax: string;
  fees: string;
  note: string;
  narrative: string;
  noReceipt: boolean;
  noReceiptReason: string;
};

/** Reads just the snapshot's own fields off a superset object — used where the caller
 *  already fetched extra, unrelated columns alongside them (see `updateExpenseAction`). */
function pickSnapshot(row: ExpenseAuditSnapshot): ExpenseAuditSnapshot {
  return {
    name: row.name,
    lineItemId: row.lineItemId,
    lineItemName: row.lineItemName,
    fundingSourceName: row.fundingSourceName,
    paymentSource: row.paymentSource,
    month: row.month,
    date: row.date,
    description: row.description,
    subtotalCents: row.subtotalCents,
    taxCents: row.taxCents,
    feesCents: row.feesCents,
    taxReimbursable: row.taxReimbursable,
    feesReimbursable: row.feesReimbursable,
    note: row.note,
    narrative: row.narrative,
    noReceipt: row.noReceipt,
    noReceiptReason: row.noReceiptReason,
  };
}

/** Signals a row that existed at the read inside a transaction but was gone by the write — a
 *  concurrent delete raced this one. Caught at the call site and turned into the normal
 *  "no longer exists" failure; never leaks past the action that throws it. */
class ExpenseRaceLost extends Error {
  constructor(message = "That expense no longer exists.") {
    super(message);
  }
}

/** Signals a locked-month refusal out of `permanentlyDeleteExpenseAction`'s transaction, which
 *  otherwise only returns via `db.transaction`'s resolved value — thrown so it rolls back
 *  the same way `ExpenseRaceLost` does, alongside it in that function's one try/catch. */
class MonthLockedRefusal extends Error {
  constructor(readonly locked: MonthRef) {
    super();
  }
}

export async function createExpenseAction(
  input: ExpenseInput,
): Promise<ActionResult<{ id: string }>> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const invalid = validate(input);
  if (invalid) return fail(invalid);

  const source = await requireOwnedFundingSource(current, input.fundingSourceId);
  if ("denied" in source) return source.denied;
  if (source.archivedAt) {
    return fail("That funding source is archived. Unarchive it in Settings to add expenses to it.");
  }

  // Scoped to the funding source too, not just the org: this is the invariant that makes
  // "saving against another source's line item is impossible" hold even if this check were
  // ever forgotten — the composite FK `expenses(line_item_id, funding_source_id) →
  // line_items(id, funding_source_id)` (D-93) backstops it at the database.
  const owned = await db
    .select({ id: lineItems.id, name: lineItems.name })
    .from(lineItems)
    .where(
      and(
        eq(lineItems.id, input.lineItemId),
        eq(lineItems.orgId, current.orgId),
        eq(lineItems.fundingSourceId, input.fundingSourceId),
      ),
    )
    .limit(1);
  if (owned.length === 0) return fail("Choose a line item.");

  // The label is stored verbatim and prints on the submitted cover sheet, so it must be
  // one this organisation actually offers rather than whatever the client posted.
  if (!(await isKnownPaymentSource(current.orgId, input.paymentSource))) {
    return fail("Choose a payment source.");
  }

  const row = toRow(input);

  // One monotonic counter per month keeps the flat list, the cover sheet rows and the
  // Excel grouping in one consistent order (data-model).
  //
  // Deliberately not filtered on `deletedAt`: a trashed row keeps its sortOrder, and
  // excluding it here would let a new expense take a number a restored row already holds.
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${expenses.sortOrder}), -1) + 1` })
    .from(expenses)
    .where(and(eq(expenses.orgId, current.orgId), eq(expenses.month, row.month)));

  // The insert and its audit event must land together: if the second write failed after the
  // first committed, the expense would exist with no record of who created it, defeating the
  // audit trail's whole purpose.
  const created = await db.transaction(async (tx) => {
    // First thing inside the transaction, before any write (R10.7, D-96) — the month must
    // still be checked here even though a page can't reach this month at all once locked,
    // because the block has to hold for a page that was already open before the lock landed.
    const locked = await monthLocked(tx, current.orgId, [
      { fundingSourceId: input.fundingSourceId, month: row.month },
    ]);
    if (locked) return { ok: false as const, locked };

    // The one supplier for row + reference + audit event, shared with `approveDraftAction` and
    // the from-invoice route so the three cannot drift (see its own doc comment).
    const row_ = await insertExpenseWithAudit(tx, {
      orgId: current.orgId,
      actorUserId: current.userId,
      row,
      lineItemName: owned[0].name,
      fundingSourceName: source.name,
      sortOrder: Number(next),
    });

    return { ok: true as const, row: row_ };
  });
  if (!created.ok) return fail(UI.monthLocked(monthLabel(created.locked.month)));

  await learnVendor(current.orgId, row);
  revalidatePath("/", "layout");
  return ok({ id: created.row.id });
}

export async function updateExpenseAction(input: ExpenseInput): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!input.id) return fail("That expense no longer exists.");

  const invalid = validate(input);
  if (invalid) return fail(invalid);
  if (!isUuid(input.id)) return fail("That expense no longer exists.");

  const source = await requireOwnedFundingSource(current, input.fundingSourceId);
  if ("denied" in source) return source.denied;

  // The line item must belong to this organisation AND the (possibly new) source. Without
  // this check an update could rebind an expense to another source's — or another
  // organisation's — line item, the same invariant `createExpenseAction` enforces.
  const ownsLineItem = await db
    .select({ id: lineItems.id, name: lineItems.name })
    .from(lineItems)
    .where(
      and(
        eq(lineItems.id, input.lineItemId),
        eq(lineItems.orgId, current.orgId),
        eq(lineItems.fundingSourceId, input.fundingSourceId),
      ),
    )
    .limit(1);
  if (ownsLineItem.length === 0) return fail("Choose a line item.");

  // An expense keeps the label it was saved with, even after that label is retired (R5.1,
  // R5.2). Re-validating an unchanged value would make every historical expense
  // uneditable the moment its payment source is deactivated — and the only way out would be
  // to overwrite the snapshot that already printed on a submitted cover sheet. Only a
  // *changed* label has to be one the organisation currently offers.
  // Joined to lineItems for the OLD line item's name, and fundingSources for the OLD source's
  // name: the snapshot has to name whatever this expense belonged to before the update, which
  // is not necessarily what the form is about to save — an edit can move either one.
  const [existing] = await db
    .select({
      month: expenses.month,
      fundingSourceId: expenses.fundingSourceId,
      fundingSourceName: fundingSources.name,
      recurringItemId: expenses.recurringItemId,
      sortOrder: expenses.sortOrder,
      referenceSeq: expenses.referenceSeq,
      name: expenses.name,
      lineItemId: expenses.lineItemId,
      lineItemName: lineItems.name,
      paymentSource: expenses.paymentSource,
      date: expenses.date,
      description: expenses.description,
      subtotalCents: expenses.subtotalCents,
      taxCents: expenses.taxCents,
      feesCents: expenses.feesCents,
      taxReimbursable: expenses.taxReimbursable,
      feesReimbursable: expenses.feesReimbursable,
      note: expenses.note,
      narrative: expenses.narrative,
      noReceipt: expenses.noReceipt,
      noReceiptReason: expenses.noReceiptReason,
    })
    .from(expenses)
    .innerJoin(lineItems, eq(lineItems.id, expenses.lineItemId))
    .innerJoin(fundingSources, eq(fundingSources.id, expenses.fundingSourceId))
    .where(
      and(
        eq(expenses.id, input.id),
        eq(expenses.orgId, current.orgId),
        isNull(expenses.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) return fail("That expense no longer exists.");

  if (
    input.paymentSource !== existing.paymentSource &&
    !(await isKnownPaymentSource(current.orgId, input.paymentSource))
  ) {
    return fail("Choose a payment source.");
  }

  // Moving source is allowed; moving INTO an archived source is not. An expense that already
  // sits on an archived source (source unchanged) stays editable — history corrections.
  const sourceChanged = existing.fundingSourceId !== input.fundingSourceId;
  if (sourceChanged && source.archivedAt) {
    return fail("That funding source is archived. Unarchive it in Settings to move expenses into it.");
  }

  const row = toRow(input);

  // Moving an expense to another month must give it that month's next counter value,
  // otherwise it collides with a row already there and the packet ordering becomes
  // ambiguous (the counter is per month).

  let sortOrder = existing.sortOrder;
  if (existing.month !== row.month) {
    // Deliberately not filtered on `deletedAt`: see the same counter in createExpenseAction.
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${expenses.sortOrder}), -1) + 1` })
      .from(expenses)
      .where(and(eq(expenses.orgId, current.orgId), eq(expenses.month, row.month)));
    sortOrder = Number(next);
  }

  // The reference names the packet the expense appears in, so a move to another month OR
  // another funding source earns that target's next number — the same reasoning as a month
  // move, generalised (D-93 R2.6). Staying put keeps the number it was given.
  const moved = existing.month !== row.month || sourceChanged;
  // Captured so the narrowing from the guard above survives into the retry callback.
  const expenseId = input.id;
  // `existing` was already fetched with exactly the snapshot's fields (plus unrelated ones
  // this update logic also needs) — `pickSnapshot` reads off it directly rather than a
  // second hand-maintained field list next to `EXPENSE_SNAPSHOT_COLUMNS`.
  const beforeSnapshot = pickSnapshot(existing);

  // The update and its audit event must land together — see the same reasoning in
  // createExpenseAction. A failure between them would otherwise leave an edit applied with no
  // record of what it changed from.
  const updated = await db.transaction(async (tx) => {
    // First thing inside the transaction, before any write, and before claimReferenceSeq below
    // (R10.7, D-96) — checks both the expense's current month and its target month, so a
    // refused move can never spend the target month's reference number (plan §3.4).
    const locked = await monthLocked(tx, current.orgId, [
      { fundingSourceId: existing.fundingSourceId, month: existing.month },
      { fundingSourceId: input.fundingSourceId, month: row.month },
    ]);
    if (locked) return { ok: false as const, locked };

    const nextReferenceSeq = moved
      ? await claimReferenceSeq(current.orgId, input.fundingSourceId, row.month, tx)
      : undefined;

    const updated_ = await tx
      .update(expenses)
      .set({
        ...row,
        sortOrder,
        ...(nextReferenceSeq !== undefined ? { referenceSeq: nextReferenceSeq } : {}),
        // Review fix: a recurring template's Remove targets expenses by this link (m05). Once
        // the expense has moved to another source, it is no longer the one the template's
        // month page is looking at — keeping the link let Remove on the *old* source's
        // template reach into the *new* source's month and trash an expense that had already
        // moved on.
        ...(sourceChanged ? { recurringItemId: null } : {}),
      })
      .where(
        and(
          eq(expenses.id, expenseId),
          eq(expenses.orgId, current.orgId),
          isNull(expenses.deletedAt),
          // Matches only the row the guard above just checked — a move that commits between
          // the read at the top of this action and the guard would otherwise leave the guard
          // having checked the wrong month while this WHERE still finds (and updates) the row.
          eq(expenses.month, existing.month),
          eq(expenses.fundingSourceId, existing.fundingSourceId),
        ),
      )
      .returning({ id: expenses.id });

    // The WHERE above can match nothing either because the row is genuinely gone, or because
    // it moved out from under the guard (same race the comment above describes). Re-read by id
    // alone to tell them apart — "moved" gets a distinct message so the user knows to reload
    // rather than assume the expense was deleted.
    if (updated_.length === 0) {
      const [stillThere] = await tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.id, expenseId), eq(expenses.orgId, current.orgId), isNull(expenses.deletedAt)))
        .limit(1);
      return {
        ok: true as const,
        rows: updated_,
        removedDocs: [],
        raceMessage: stillThere ? "That expense just changed. Try again." : "That expense no longer exists.",
      };
    }

    if (updated_.length > 0) {
      await tx.insert(expenseAuditEvents).values({
        orgId: current.orgId,
        expenseId,
        actorUserId: current.userId,
        action: "edited",
        beforeData: beforeSnapshot,
        afterData: snapshotOf(row, ownsLineItem[0].name, source.name),
      });
    }

    // "No receipt available" and attached receipts are mutually exclusive (R4.2): saving with
    // the box ticked removes the receipt files the user confirmed away. Deleted here, inside
    // the same guarded transaction as the update, so a lock landing between the update and a
    // separate delete cannot permanently remove files from a month that just locked. Only the
    // rows are deleted here; the stored objects themselves are removed after commit, below —
    // deleting them first would destroy files irreversibly even when the save then failed.
    const removedDocs =
      updated_.length > 0 && row.noReceipt
        ? await tx
            .delete(expenseDocuments)
            .where(
              and(
                eq(expenseDocuments.expenseId, expenseId),
                eq(expenseDocuments.orgId, current.orgId),
                eq(expenseDocuments.kind, "receipt"),
              ),
            )
            .returning({ key: expenseDocuments.s3Key })
        : [];

    return { ok: true as const, rows: updated_, removedDocs, raceMessage: undefined as string | undefined };
  });
  if (!updated.ok) return fail(UI.monthLocked(monthLabel(updated.locked.month)));
  if (updated.rows.length === 0) return fail(updated.raceMessage ?? "That expense no longer exists.");

  // Carry a corrected narrative back to the template it came from, so next month's one-click
  // add arrives with the current text and nobody reopens an old month to copy it (R8.3, D-66).
  //
  // Only from an expense that came from the template, and only when there is something to
  // carry: a blank narrative here means "not written yet", not "delete the paragraph". The
  // template's own field on the Recurring screen is where clearing is done, deliberately.
  //
  // Skipped once the source has changed (review fix): the link to the old template was just
  // cleared above, and the wording that applies now belongs to whichever source this expense
  // sits on today — writing it back would restate a source-A correction onto a source-A
  // template from what is now a source-B expense.
  if (!sourceChanged) {
    await carryNarrativeToTemplate({
      orgId: current.orgId,
      recurringItemId: existing.recurringItemId,
      narrative: row.narrative,
    });
  }

  // The rows are already gone (deleted inside the transaction above); the stored objects are
  // only removed now that the transaction has committed.
  for (const doc of updated.removedDocs) {
    await deleteStoredObjects(doc.key);
  }

  await learnVendor(current.orgId, row);
  revalidatePath("/", "layout");
  return ok();
}

/** Move an expense to the trash. Its documents are left in place, for restore. */
export async function deleteExpenseAction(id: string): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail("That expense no longer exists.");

  // The trash-update and its audit event must land together — see the same reasoning in
  // createExpenseAction. A failure between them would trash an expense with no record of it.
  const trashed = await db.transaction(async (tx) => {
    // Read the (fundingSourceId, month) the update below would touch, under the same filter,
    // so the guard runs before any write. A row already gone falls through unguarded — the
    // update's own WHERE finds nothing either way, the ordinary "no longer exists" case.
    const [found] = await tx
      .select({ fundingSourceId: expenses.fundingSourceId, month: expenses.month })
      .from(expenses)
      .where(
        and(eq(expenses.id, id), eq(expenses.orgId, current.orgId), isNull(expenses.deletedAt)),
      )
      .limit(1);
    if (found) {
      const locked = await monthLocked(tx, current.orgId, [
        { fundingSourceId: found.fundingSourceId, month: found.month },
      ]);
      if (locked) return { ok: false as const, locked };
    }

    const trashed_ = await tx
      .update(expenses)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(expenses.id, id),
          eq(expenses.orgId, current.orgId),
          isNull(expenses.deletedAt),
          // Matches only the row the guard above just checked (see the same comment in
          // updateExpenseAction) — a move landing between the read and the guard would
          // otherwise still match here on id alone.
          ...(found
            ? [eq(expenses.month, found.month), eq(expenses.fundingSourceId, found.fundingSourceId)]
            : []),
        ),
      )
      .returning(EXPENSE_SNAPSHOT_COLUMNS);
    if (trashed_.length === 0) {
      // `found` null already means "gone" (ordinary case); `found` set but nothing updated
      // means it moved between the read and this write.
      const raceMessage = found ? "That expense just changed. Try again." : "That expense no longer exists.";
      return { ok: true as const, rows: trashed_, raceMessage };
    }
    await insertDeletedAudit(tx, {
      orgId: current.orgId,
      actorUserId: current.userId,
      expenseId: id,
      row: trashed_[0],
    });

    return { ok: true as const, rows: trashed_, raceMessage: undefined as string | undefined };
  });
  if (!trashed.ok) return fail(UI.monthLocked(monthLabel(trashed.locked.month)));
  if (trashed.rows.length === 0) return fail(trashed.raceMessage ?? "That expense no longer exists.");

  revalidatePath("/", "layout");
  return ok();
}

/** Bring a trashed expense back. Its documents were never touched, so nothing to restore there. */
export async function restoreExpenseAction(id: string): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail("That expense no longer exists.");

  // Same reasoning as deleteExpenseAction: the restore and its audit event must land together.
  const restored = await db.transaction(async (tx) => {
    // Same guard shape as deleteExpenseAction: read the (fundingSourceId, month) the update
    // below would touch, under the same filter, before any write.
    const [found] = await tx
      .select({ fundingSourceId: expenses.fundingSourceId, month: expenses.month })
      .from(expenses)
      .where(
        and(eq(expenses.id, id), eq(expenses.orgId, current.orgId), isNotNull(expenses.deletedAt)),
      )
      .limit(1);
    if (found) {
      const locked = await monthLocked(tx, current.orgId, [
        { fundingSourceId: found.fundingSourceId, month: found.month },
      ]);
      if (locked) return { ok: false as const, locked };
    }

    const restored_ = await tx
      .update(expenses)
      .set({ deletedAt: null })
      .where(
        and(
          eq(expenses.id, id),
          eq(expenses.orgId, current.orgId),
          isNotNull(expenses.deletedAt),
          // Same reasoning as deleteExpenseAction's WHERE — matches only the row the guard
          // above just checked.
          ...(found
            ? [eq(expenses.month, found.month), eq(expenses.fundingSourceId, found.fundingSourceId)]
            : []),
        ),
      )
      .returning(EXPENSE_SNAPSHOT_COLUMNS);
    if (restored_.length === 0) {
      const raceMessage = found ? "That expense just changed. Try again." : "That expense no longer exists.";
      return { ok: true as const, rows: restored_, raceMessage };
    }
    const [row] = restored_;

    // RETURNING cannot reach a joined table, so the line item's (and its source's) name costs
    // one extra select, the same cost as `deleteExpenseAction`.
    const [lineItem] = await tx
      .select({ name: lineItems.name, fundingSourceName: fundingSources.name })
      .from(lineItems)
      .innerJoin(fundingSources, eq(fundingSources.id, lineItems.fundingSourceId))
      .where(eq(lineItems.id, row.lineItemId))
      .limit(1);

    await tx.insert(expenseAuditEvents).values({
      orgId: current.orgId,
      expenseId: id,
      actorUserId: current.userId,
      action: "restored",
      beforeData: null,
      afterData: snapshotOf(row, lineItem?.name ?? "", lineItem?.fundingSourceName ?? ""),
    });

    return { ok: true as const, rows: restored_, raceMessage: undefined as string | undefined };
  });
  if (!restored.ok) return fail(UI.monthLocked(monthLabel(restored.locked.month)));
  if (restored.rows.length === 0) return fail(restored.raceMessage ?? "That expense no longer exists.");

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Remove a trashed expense for good. The WHERE requires `deletedAt` already set, so an
 * active expense can never be hard-deleted without going through the trash first.
 */
export async function permanentlyDeleteExpenseAction(id: string): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail("That expense no longer exists.");

  // The key is captured now, before the expense is deleted below — the expenseDocuments
  // rows cascade with it (onDelete: "cascade"), so a lookup by id afterward would find
  // nothing and silently skip the storage cleanup entirely.
  const documents = await db
    .select({ s3Key: expenseDocuments.s3Key })
    .from(expenseDocuments)
    .where(and(eq(expenseDocuments.expenseId, id), eq(expenseDocuments.orgId, current.orgId)));

  // Confirmed to exist before the audit event is written: the event's `expense_id` FK
  // requires a real row to point at, so a nonexistent or already-gone id must fail here
  // rather than at the insert below. Extended to the full field set + a lineItems join so
  // this snapshot — the last chance to record what this expense was, since the row is about
  // to be gone for good — costs no extra query.
  const exists = await db
    .select({
      ...EXPENSE_SNAPSHOT_COLUMNS,
      lineItemName: lineItems.name,
      lineItemFundingSourceName: fundingSources.name,
    })
    .from(expenses)
    .innerJoin(lineItems, eq(lineItems.id, expenses.lineItemId))
    .innerJoin(fundingSources, eq(fundingSources.id, lineItems.fundingSourceId))
    .where(
      and(eq(expenses.id, id), eq(expenses.orgId, current.orgId), isNotNull(expenses.deletedAt)),
    )
    .limit(1);
  if (exists.length === 0) return fail("That expense no longer exists.");
  const { lineItemName, lineItemFundingSourceName, ...existsRow } = exists[0];

  // The audit event and the delete must land together, in this order and inside one real
  // transaction: the event is written first, while the row it points at (still required by
  // the FK) exists, then the delete removes it, which the FK's `onDelete: "set null"`
  // (schema.ts) turns into nulling the just-inserted event's `expense_id` — all before commit.
  // If the delete finds nothing (a concurrent delete raced this one), `ExpenseRaceLost`
  // rolls the whole transaction back, undoing the audit insert with it — no separate
  // compensating delete needed, and no window where a failed delete leaves a stray event.
  try {
    await db.transaction(async (tx) => {
      // First thing inside the transaction, before any write (R10.7, D-96).
      const locked = await monthLocked(tx, current.orgId, [
        { fundingSourceId: existsRow.fundingSourceId, month: existsRow.month },
      ]);
      if (locked) throw new MonthLockedRefusal(locked);

      await tx.insert(expenseAuditEvents).values({
        orgId: current.orgId,
        expenseId: id,
        actorUserId: current.userId,
        action: "permanently_deleted",
        beforeData: snapshotOf(existsRow, lineItemName, lineItemFundingSourceName),
        afterData: null,
      });

      const deleted = await tx
        .delete(expenses)
        .where(
          and(
            eq(expenses.id, id),
            eq(expenses.orgId, current.orgId),
            isNotNull(expenses.deletedAt),
            // Matches only the row the guard above just checked (same reasoning as
            // updateExpenseAction's WHERE) — a move committing between the outer read and the
            // guard would otherwise still match here on id alone.
            eq(expenses.month, existsRow.month),
            eq(expenses.fundingSourceId, existsRow.fundingSourceId),
          ),
        )
        .returning({ id: expenses.id });
      if (deleted.length === 0) {
        // Re-select by id alone (still inside this transaction, about to roll back either
        // way) to tell "moved" from "gone" for the message below.
        const [stillThere] = await tx
          .select({ id: expenses.id })
          .from(expenses)
          .where(and(eq(expenses.id, id), eq(expenses.orgId, current.orgId), isNotNull(expenses.deletedAt)))
          .limit(1);
        throw new ExpenseRaceLost(
          stillThere ? "That expense just changed. Try again." : "That expense no longer exists.",
        );
      }
    });
  } catch (error) {
    if (error instanceof ExpenseRaceLost) return fail(error.message);
    if (error instanceof MonthLockedRefusal) return fail(UI.monthLocked(monthLabel(error.locked.month)));
    throw error;
  }

  // The rows are already gone (cascaded above); only the stored objects are left to clean
  // up, best-effort — swept later if any deletion fails (data-model §Cleanup).
  for (const document of documents) {
    await deleteStoredObjects(document.s3Key);
  }

  revalidatePath("/", "layout");
  return ok();
}

/** Remove one attached file (immediate — the form warns that Cancel will not undo it). */
export async function removeExpenseDocumentAction(documentId: string): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(documentId)) return fail("That file is already gone.");

  // The expense's own (fundingSourceId, month) is what the guard checks — a file has no month
  // of its own. Read before the transaction, same as the other guarded paths' lookups.
  const [owner] = await db
    .select({
      fundingSourceId: expenses.fundingSourceId,
      month: expenses.month,
    })
    .from(expenseDocuments)
    .innerJoin(expenses, eq(expenses.id, expenseDocuments.expenseId))
    .where(and(eq(expenseDocuments.id, documentId), eq(expenseDocuments.orgId, current.orgId)))
    .limit(1);

  // Guard, then delete the row in one transaction; the stored objects are only removed after
  // that commits (plan §3.4) — deleting them first and then having the guard refuse would
  // destroy the file irreversibly on a locked month.
  const removed = await db.transaction(async (tx) => {
    if (owner) {
      const locked = await monthLocked(tx, current.orgId, [
        { fundingSourceId: owner.fundingSourceId, month: owner.month },
      ]);
      if (locked) return { ok: false as const, locked };

      // The pre-transaction read above is a fast lookup only — a move landing between it and
      // the guard would leave `owner` stale. Re-read the document's owning expense here, inside
      // the transaction and after the guard, and refuse if it no longer matches — same reasoning
      // as `ingestExpenseDocument`'s re-read (src/services/storage/documents.ts).
      const [after] = await tx
        .select({ fundingSourceId: expenses.fundingSourceId, month: expenses.month })
        .from(expenseDocuments)
        .innerJoin(expenses, eq(expenses.id, expenseDocuments.expenseId))
        .where(and(eq(expenseDocuments.id, documentId), eq(expenseDocuments.orgId, current.orgId)))
        .limit(1);
      if (!after || after.month !== owner.month || after.fundingSourceId !== owner.fundingSourceId) {
        return { ok: true as const, rows: [], raceMessage: "That expense just changed. Try again." };
      }
    }

    const rows = await tx
      .delete(expenseDocuments)
      .where(and(eq(expenseDocuments.id, documentId), eq(expenseDocuments.orgId, current.orgId)))
      .returning({ key: expenseDocuments.s3Key });
    return { ok: true as const, rows, raceMessage: undefined as string | undefined };
  });
  if (!removed.ok) return fail(UI.monthLocked(monthLabel(removed.locked.month)));
  if (removed.rows.length === 0) return fail(removed.raceMessage ?? "That file is already gone.");

  await deleteStoredObjects(removed.rows[0].key);

  revalidatePath("/", "layout");
  return ok();
}

/** One remembered payee, as much of it as the expense form can offer to fill in (R8.1). */
export type VendorSuggestion = {
  name: string;
  lineItemId: string | null;
  description: string;
  /** Null means never learned. Not offered if the label has since been retired (R5.2). */
  paymentSource: string | null;
  /** Null means nothing has been learned yet, which is not the same as zero. */
  subtotalCents: number | null;
  taxCents: number | null;
  feesCents: number | null;
};

/**
 * One expense's audit history, admin-only (D-89) — backs the three-dot menu's "View history".
 * The real security boundary: the client-side `isAdmin` prop that shows the menu is UI hiding
 * only, this is what actually enforces it, and it reads `current.orgId` from the session
 * rather than ever trusting an org id from the client.
 */
export async function loadExpenseHistoryAction(
  expenseId: string,
): Promise<ActionResult<{ events: OrgAuditEvent[]; truncated: boolean }>> {
  const current = await requireAdmin();
  if ("denied" in current) return current.denied;
  if (!isUuid(expenseId)) return fail("That expense no longer exists.");

  // One page is all this view shows — an expense with more events than that is far past what
  // anyone reads in a modal. `truncated` is carried through so the UI can say so: silently
  // dropping the rest would make an audit trail lie about being complete.
  const { events, hasNextPage } = await loadOrgAuditHistory(current.orgId, { expenseId });
  return ok({ events, truncated: hasNextPage });
}

/** Vendor autofill lookup (R8.1): exact match fills the form, partials are suggestions. */
export async function searchVendorsAction(
  query: string,
): Promise<ActionResult<VendorSuggestion[]>> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const term = query.trim();
  if (term.length === 0) return ok([]);

  const rows = await db
    .select({
      name: vendorDefaults.name,
      lineItemId: vendorDefaults.defaultLineItemId,
      description: vendorDefaults.defaultDescription,
      paymentSource: vendorDefaults.defaultPaymentSource,
      subtotalCents: vendorDefaults.defaultSubtotalCents,
      taxCents: vendorDefaults.defaultTaxCents,
      feesCents: vendorDefaults.defaultFeesCents,
    })
    .from(vendorDefaults)
    .where(
      and(
        eq(vendorDefaults.orgId, current.orgId),
        sql`${vendorDefaults.name} ilike ${"%" + term + "%"}`,
      ),
    )
    .orderBy(vendorDefaults.name)
    .limit(6);

  return ok(rows);
}

