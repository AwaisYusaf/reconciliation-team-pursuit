"use server";

/**
 * Line item management (m08).
 *
 * Renaming needs no cascade: expenses, recurring items and vendor defaults all reference
 * a line item by id, so a rename is a single update and history follows automatically.
 */
import { and, asc, count, eq, or, sql, sum } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import { isDeadlock, isUniqueViolation, LINE_ITEM_GONE, unlessLineItemGone } from "@/src/db/pg-errors";
import { expenseDrafts, expenses, lineItemPerformances, lineItems, recurringItems } from "@/src/db/schema";
import { isValidIsoDate } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { fundingTotalCents, raisesOverLimit } from "@/src/domain/funding-limit";
import { isDuplicateName, planLineItemDelete, sameCascade } from "@/src/domain/line-item-rules";
import { parseMoneyToCents } from "@/src/domain/money";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { isUuid } from "@/src/lib/ids";
import { loadFundingPosition, requireOwnedFundingSource } from "@/src/modules/funding-sources/queries";


/** Every screen reads line items, so a change invalidates the whole authenticated tree. */
function revalidateAll(): void {
  revalidatePath("/", "layout");
}

export async function saveLineItemAction(input: {
  id?: string;
  fundingSourceId: string;
  name: string;
  scheduledValue: string;
  openingBilled: string;
}): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const source = await requireOwnedFundingSource(current, input.fundingSourceId);
  if ("denied" in source) return source.denied;

  const name = input.name.trim();
  if (!name) return fail("Enter a line item name.");

  const scheduledValueCents = parseMoneyToCents(input.scheduledValue);
  if (scheduledValueCents === null || scheduledValueCents < 0) {
    return fail("Enter a scheduled value.");
  }

  const openingBilledCents = parseMoneyToCents(input.openingBilled) ?? 0;
  if (openingBilledCents < 0) return fail("Opening previously billed cannot be negative.");

  // Case-insensitive uniqueness matches the database index (`line_items_source_name_uq`),
  // scoped to this source — two sources can each have a "Salary". This check gives the
  // friendly message in the ordinary case; two saves of the same name at once both pass it, and
  // the catch below turns the index's refusal into the same message (Phase 0 B6).
  const existing = await db
    .select({ id: lineItems.id, name: lineItems.name })
    .from(lineItems)
    .where(eq(lineItems.fundingSourceId, source.id));
  if (isDuplicateName(name, existing, input.id)) return fail(UI.lineItemDuplicate);

  const ARCHIVED = "That funding source is archived. Unarchive it in Settings to add line items.";
  if (input.id) {
    // A malformed id would reach a uuid column and raise a Postgres 22P02 rather than a
    // handled failure; "no longer exists" is both true and what a probe should learn.
    if (!isUuid(input.id)) return fail("That line item no longer exists.");
  } else if (source.archivedAt) {
    // Archived sources still hold history, but no new line item may be added to one.
    return fail(ARCHIVED);
  }

  try {
    // One transaction with the funding source row locked (R9.6), so this and a contract value
    // change on the same source queue, and each checks the funding limit on the other's result.
    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      const before = await loadFundingPosition(tx, current.orgId, source.id, true);
      if (!before) return fail("Choose a funding source.");
      // Re-checked under the lock (R14.3): an archive can commit while this waited for it.
      if (!input.id && before.archivedAt) return fail(ARCHIVED);

      let previousCents = 0;
      if (input.id) {
        const [row] = await tx
          .select({ cents: lineItems.scheduledValueCents })
          .from(lineItems)
          .where(
            and(
              eq(lineItems.id, input.id),
              eq(lineItems.orgId, current.orgId),
              eq(lineItems.fundingSourceId, source.id),
            ),
          )
          .for("no key update");
        if (!row) return fail("That line item no longer exists.");
        previousCents = row.cents;
      }

      const after = { ...before, scheduledCents: before.scheduledCents - previousCents + scheduledValueCents };
      if (raisesOverLimit(before, after)) {
        return fail(
          UI.fundingLimitExceeded(formatMoney(after.scheduledCents), formatMoney(fundingTotalCents(after))),
        );
      }

      if (input.id) {
        // No `.returning` check: the row was just read under a lock in this transaction.
        await tx
          .update(lineItems)
          .set({ name, scheduledValueCents, openingBilledCents })
          .where(
            and(
              eq(lineItems.id, input.id),
              eq(lineItems.orgId, current.orgId),
              eq(lineItems.fundingSourceId, source.id),
            ),
          );
      } else {
        const [{ value: maxSort }] = await tx
          .select({ value: sql<number>`coalesce(max(${lineItems.sortOrder}), -1)` })
          .from(lineItems)
          .where(eq(lineItems.fundingSourceId, source.id));

        await tx.insert(lineItems).values({
          orgId: current.orgId,
          fundingSourceId: source.id,
          name,
          scheduledValueCents,
          openingBilledCents,
          sortOrder: Number(maxSort) + 1,
        });
      }
      return ok();
    });
    if (!result.ok) return result;
  } catch (error) {
    if (isUniqueViolation(error)) return fail(UI.lineItemDuplicate);
    throw error;
  }

  revalidateAll();
  return ok();
}

/** What the delete dialog listed: the recurring items and performance total going with it. */
export type LineItemDeleteConfirmation = {
  recurringNames: string[];
  performanceTotalCents: number;
};

/** A delete confirmation as the dialog sends it: checked, since it arrives from the client. */
function isCascade(value: unknown): value is LineItemDeleteConfirmation {
  const candidate = value as Partial<LineItemDeleteConfirmation> | null;
  return (
    typeof value === "object" &&
    candidate !== null &&
    Array.isArray(candidate.recurringNames) &&
    candidate.recurringNames.every((name) => typeof name === "string") &&
    Number.isSafeInteger(candidate.performanceTotalCents)
  );
}

/**
 * Delete a line item (R9.3).
 *
 * Blocked outright while expenses reference it. Recurring items and performances are
 * cascade-deleted, so the caller must have confirmed: `confirmed` is the list the client was
 * shown, sent back. A bare "yes" is not enough (Phase 0 B5): if the list changed since the
 * dialog, the server asks again with the new one instead of deleting what nobody saw.
 */
export async function deleteLineItemAction(
  id: string,
  confirmed: LineItemDeleteConfirmation | false = false,
): Promise<ActionResult<{ requiresConfirmation?: LineItemDeleteConfirmation }>> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail("That line item no longer exists.");
  // Anything but "not yet" (false) or a well-formed list is refused before anything is read. A
  // page loaded before the list replaced a bare `true` still sends `true`; answering that with
  // ok made it say "Line item deleted." when nothing was (PR #25 review).
  if (confirmed !== false && confirmed !== undefined && !isCascade(confirmed)) {
    return fail(UI.lineItemDeleteReload);
  }

  // One transaction with the line item's row locked (Phase 0 B5). Adding an expense, recurring
  // item or performance on it must lock the same row for its foreign key, so none can land
  // between the counts below and the delete: the counts are what gets deleted. They used to run
  // outside any transaction, so an expense saved in between reached the database's `restrict`
  // as an unhandled error here, and a recurring item added in between was deleted unseen. A save
  // that arrives while this holds the lock waits, then finds the line item gone; every such save
  // path answers that with `UI.lineItemGone` (`unlessLineItemGone`), not an error page.
  type DeleteResult = ActionResult<{ requiresConfirmation?: LineItemDeleteConfirmation }>;
  let result: DeleteResult;
  try {
    result = await db.transaction(async (tx): Promise<DeleteResult> => {
      // Drafts pointing at it first, then the line item: the same order approving a draft takes
      // (draft row, then the line item for the new expense's foreign key), so the two queue
      // instead of deadlocking. The delete empties these drafts' line item (`set null`).
      await tx
        .select({ id: expenseDrafts.id })
        .from(expenseDrafts)
        .where(and(eq(expenseDrafts.orgId, current.orgId), eq(expenseDrafts.lineItemId, id)))
        .for("update");

      const [lineItem] = await tx
        .select({ name: lineItems.name })
        .from(lineItems)
        .where(and(eq(lineItems.id, id), eq(lineItems.orgId, current.orgId)))
        .for("update");
      if (!lineItem) return fail("That line item no longer exists.");

      // Not filtered on `deletedAt`: the FK is `onDelete: "restrict"`, so a trashed expense
      // still blocks this delete at the database. Filtering here would turn a clean refusal
      // into a Postgres FK error — the trash has to be emptied first.
      const [{ total }] = await tx
        .select({ total: count() })
        .from(expenses)
        .where(and(eq(expenses.orgId, current.orgId), eq(expenses.lineItemId, id)));
      const recurring = await tx
        .select({ name: recurringItems.name })
        .from(recurringItems)
        .where(and(eq(recurringItems.orgId, current.orgId), eq(recurringItems.lineItemId, id)));
      const [{ performanceTotal }] = await tx
        .select({ performanceTotal: sum(lineItemPerformances.amountCents) })
        .from(lineItemPerformances)
        .where(
          and(eq(lineItemPerformances.orgId, current.orgId), eq(lineItemPerformances.lineItemId, id)),
        );

      const plan = planLineItemDelete({
        name: lineItem.name,
        expenseCount: total,
        recurringNames: recurring.map((row) => row.name),
        performanceTotalCents: Number(performanceTotal ?? 0),
      });
      if (!plan.allowed) return fail(plan.reason);
      const cascade = {
        recurringNames: plan.cascadingRecurring,
        performanceTotalCents: plan.performanceTotalCents,
      };
      // Always ask, even when nothing cascades: the client shows exactly one dialog either way,
      // and an empty line item is still a record someone typed.
      if (!confirmed || !sameCascade(confirmed, cascade)) return ok({ requiresConfirmation: cascade });

      // Performances cascade with the line item (FK `onDelete: "cascade"`) — nothing further to
      // clean up here, unlike documents/storage, since a performance is just a number, not a
      // stored file.
      await tx.delete(lineItems).where(and(eq(lineItems.id, id), eq(lineItems.orgId, current.orgId)));
      return ok({});
    });
  } catch (error) {
    // Other rows that point at a line item (vendor defaults, month snapshots, generated files)
    // are emptied by the delete too; a writer holding one of those while waiting for this line
    // item can still form a cycle. Postgres then rolls one side back, and nothing was deleted.
    if (isDeadlock(error)) return fail("That line item just changed. Try again.");
    throw error;
  }
  if (!result.ok || result.data.requiresConfirmation) return result;

  revalidateAll();
  return result;
}

/** Persist a new display order; the order drives documents as well as screens. */
export async function reorderLineItemsAction(
  orderedIds: string[],
  fundingSourceId: string,
): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const source = await requireOwnedFundingSource(current, fundingSourceId);
  if ("denied" in source) return source.denied;

  const STALE = UI.lineItemOrderStale;
  // Checked here as well as by type: an action's arguments arrive from the client unchecked.
  if (
    !Array.isArray(orderedIds) ||
    orderedIds.length === 0 ||
    !orderedIds.every(isUuid) ||
    new Set(orderedIds).size !== orderedIds.length
  ) {
    return fail(STALE);
  }

  const result = await db.transaction(async (tx) => {
    // Every line item of the source, locked in id order (Phase 0 B8). The fixed order means two
    // reorders at once queue instead of deadlocking, and the check below runs on the locked set.
    // NO KEY UPDATE, the lock the UPDATEs below take anyway, and not FOR UPDATE: expense and
    // draft inserts hold a key-share lock on their line item, which FOR UPDATE would wait for,
    // so a reorder during an invoice import (several line items, not in id order) could deadlock
    // with it. This one does not conflict with them, and still conflicts with another reorder.
    const rows = await tx
      .select({ id: lineItems.id })
      .from(lineItems)
      .where(eq(lineItems.fundingSourceId, source.id))
      .orderBy(asc(lineItems.id))
      .for("no key update");

    // The whole list and nothing else: an id from another source or organisation, a line item
    // added or deleted since the page loaded, or part of the list would each leave two line items
    // sharing a position, so the reorder is refused rather than applied partly.
    const sourceIds = new Set(rows.map((row) => row.id));
    if (rows.length !== orderedIds.length || !orderedIds.every((id) => sourceIds.has(id))) {
      return fail(STALE);
    }

    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(lineItems)
        .set({ sortOrder: index })
        .where(and(eq(lineItems.id, id), eq(lineItems.fundingSourceId, source.id)));
    }
    return ok();
  });
  if (!result.ok) return result;

  revalidateAll();
  return ok();
}

/**
 * Add a performance to a line item (m08, D-92).
 *
 * A name, amount and date, all given by whoever adds it. Only the amount rolls into
 * `scheduledValueCents` via `loadLineItemBudgets` — name/date are display-only, so every
 * screen and document that already reads the total picks up the new amount without change.
 *
 * No funding limit check in the performance actions (R9.6): a counted performance raises both
 * sides equally; a migrated one can only be edited in name/date.
 */
export async function addLineItemPerformanceAction(input: {
  lineItemId: string;
  name: string;
  amount: string;
  date: string;
}): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(input.lineItemId)) return fail("That line item no longer exists.");

  const name = input.name.trim();
  if (!name) return fail("Enter a name for this performance.");

  if (!isValidIsoDate(input.date)) return fail("Enter a valid date.");

  const amountCents = parseMoneyToCents(input.amount);
  if (amountCents === null || amountCents <= 0) return fail("Enter a performance amount.");

  const owned = await db
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(and(eq(lineItems.id, input.lineItemId), eq(lineItems.orgId, current.orgId)))
    .limit(1);
  if (owned.length === 0) return fail("That line item no longer exists.");

  const [{ value: maxSort }] = await db
    .select({ value: sql<number>`coalesce(max(${lineItemPerformances.sortOrder}), -1)` })
    .from(lineItemPerformances)
    .where(eq(lineItemPerformances.lineItemId, input.lineItemId));

  // Deleted by someone else after the check above: the insert waits on the delete, then fails.
  const added = await unlessLineItemGone(() =>
    db.insert(lineItemPerformances).values({
      orgId: current.orgId,
      lineItemId: input.lineItemId,
      name,
      date: input.date,
      amountCents,
      sortOrder: Number(maxSort) + 1,
      // Real new money the org's contract value hasn't caught up to yet (D-82) — unlike the
      // default `false` every pre-existing row (the migrated Performance Grant included) means.
      countsTowardContractTotal: true,
    }),
  );
  if (added === LINE_ITEM_GONE) return fail("That line item no longer exists.");

  revalidateAll();
  return ok();
}

/** Edit an existing performance's name, amount or date (D-92) — a typo no longer has to be
 *  corrected by deleting and re-adding, which lost the original add date/sort position. */
export async function saveLineItemPerformanceAction(input: {
  id: string;
  name: string;
  amount: string;
  date: string;
}): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(input.id)) return fail("That performance no longer exists.");

  const name = input.name.trim();
  if (!name) return fail("Enter a name for this performance.");

  if (!isValidIsoDate(input.date)) return fail("Enter a valid date.");

  const amountCents = parseMoneyToCents(input.amount);
  if (amountCents === null || amountCents <= 0) return fail("Enter a performance amount.");

  // A performance already inside the contract value (`countsTowardContractTotal` false, D-82)
  // keeps its amount: the flag can't say "only the delta is new money", so an edit would split
  // the contract total from the sum of scheduled values. Checked in the same statement as the
  // write rather than read-then-update, so nothing can slip between the check and the change.
  const updated = await db
    .update(lineItemPerformances)
    .set({ name, date: input.date, amountCents })
    .where(
      and(
        eq(lineItemPerformances.id, input.id),
        eq(lineItemPerformances.orgId, current.orgId),
        or(
          eq(lineItemPerformances.countsTowardContractTotal, true),
          eq(lineItemPerformances.amountCents, amountCents),
        ),
      ),
    )
    .returning({ id: lineItemPerformances.id });
  if (updated.length === 0) {
    const [exists] = await db
      .select({ id: lineItemPerformances.id })
      .from(lineItemPerformances)
      .where(and(eq(lineItemPerformances.id, input.id), eq(lineItemPerformances.orgId, current.orgId)));
    return fail(
      exists
        ? "This performance is already part of the contract value, so its amount can't be edited. Delete it and add a new one to change the amount."
        : "That performance no longer exists.",
    );
  }

  revalidateAll();
  return ok();
}

/** Remove one performance entry. */
export async function deleteLineItemPerformanceAction(id: string): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail("That performance no longer exists.");

  const deleted = await db
    .delete(lineItemPerformances)
    .where(and(eq(lineItemPerformances.id, id), eq(lineItemPerformances.orgId, current.orgId)))
    .returning({ id: lineItemPerformances.id });
  if (deleted.length === 0) return fail("That performance no longer exists.");

  revalidateAll();
  return ok();
}
