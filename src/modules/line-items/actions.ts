"use server";

/**
 * Line item management (m08).
 *
 * Renaming needs no cascade: expenses, recurring items and vendor defaults all reference
 * a line item by id, so a rename is a single update and history follows automatically.
 */
import { and, count, eq, inArray, sql, sum } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import { expenses, lineItemPerformances, lineItems, recurringItems } from "@/src/db/schema";
import { isDuplicateName, planLineItemDelete } from "@/src/domain/line-item-rules";
import { parseMoneyToCents } from "@/src/domain/money";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { isUuid } from "@/src/lib/ids";


/** Every screen reads line items, so a change invalidates the whole authenticated tree. */
function revalidateAll(): void {
  revalidatePath("/", "layout");
}

export async function saveLineItemAction(input: {
  id?: string;
  name: string;
  scheduledValue: string;
  openingBilled: string;
}): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const name = input.name.trim();
  if (!name) return fail("Enter a line item name.");

  const scheduledValueCents = parseMoneyToCents(input.scheduledValue);
  if (scheduledValueCents === null || scheduledValueCents < 0) {
    return fail("Enter a scheduled value.");
  }

  const openingBilledCents = parseMoneyToCents(input.openingBilled) ?? 0;
  if (openingBilledCents < 0) return fail("Opening previously billed cannot be negative.");

  // Case-insensitive uniqueness matches the database index, so the friendly message wins
  // the race rather than a constraint violation reaching the user.
  const existing = await db
    .select({ id: lineItems.id, name: lineItems.name })
    .from(lineItems)
    .where(eq(lineItems.orgId, current.orgId));
  if (isDuplicateName(name, existing, input.id)) return fail(UI.lineItemDuplicate);

  if (input.id) {
    // A malformed id would reach a uuid column and raise a Postgres 22P02 rather than a
    // handled failure; "no longer exists" is both true and what a probe should learn.
    if (!isUuid(input.id)) return fail("That line item no longer exists.");
    const updated = await db
      .update(lineItems)
      .set({ name, scheduledValueCents, openingBilledCents })
      .where(and(eq(lineItems.id, input.id), eq(lineItems.orgId, current.orgId)))
      .returning({ id: lineItems.id });
    if (updated.length === 0) return fail("That line item no longer exists.");
  } else {
    const [{ value: maxSort }] = await db
      .select({ value: sql<number>`coalesce(max(${lineItems.sortOrder}), -1)` })
      .from(lineItems)
      .where(eq(lineItems.orgId, current.orgId));

    await db.insert(lineItems).values({
      orgId: current.orgId,
      name,
      scheduledValueCents,
      openingBilledCents,
      sortOrder: Number(maxSort) + 1,
    });
  }

  revalidateAll();
  return ok();
}

/**
 * Delete a line item (R9.3).
 *
 * Blocked outright while expenses reference it. Recurring items are cascade-deleted, so
 * the caller must have confirmed — `confirmedRecurring` is the client's acknowledgement
 * of the list it was shown.
 */
export type LineItemDeleteConfirmation = {
  recurringNames: string[];
  performanceTotalCents: number;
};

export async function deleteLineItemAction(
  id: string,
  confirmedRecurring = false,
): Promise<ActionResult<{ requiresConfirmation?: LineItemDeleteConfirmation }>> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail("That line item no longer exists.");

  const rows = await db
    .select({ name: lineItems.name })
    .from(lineItems)
    .where(and(eq(lineItems.id, id), eq(lineItems.orgId, current.orgId)))
    .limit(1);
  const lineItem = rows[0];
  if (!lineItem) return fail("That line item no longer exists.");

  const [[{ total }], recurring, [{ performanceTotal }]] = await Promise.all([
    // Not filtered on `deletedAt`: the FK is `onDelete: "restrict"`, so a trashed expense
    // still blocks this delete at the database. Filtering here would turn a clean refusal
    // into a Postgres FK error — the trash has to be emptied first.
    db
      .select({ total: count() })
      .from(expenses)
      .where(and(eq(expenses.orgId, current.orgId), eq(expenses.lineItemId, id))),
    db
      .select({ name: recurringItems.name })
      .from(recurringItems)
      .where(and(eq(recurringItems.orgId, current.orgId), eq(recurringItems.lineItemId, id))),
    db
      .select({ performanceTotal: sum(lineItemPerformances.amountCents) })
      .from(lineItemPerformances)
      .where(
        and(eq(lineItemPerformances.orgId, current.orgId), eq(lineItemPerformances.lineItemId, id)),
      ),
  ]);

  const plan = planLineItemDelete({
    name: lineItem.name,
    expenseCount: total,
    recurringNames: recurring.map((row) => row.name),
    performanceTotalCents: Number(performanceTotal ?? 0),
  });
  if (!plan.allowed) return fail(plan.reason);
  // Always ask, even when nothing cascades: the client shows exactly one dialog either way,
  // and an empty line item is still a record someone typed.
  if (!confirmedRecurring) {
    return ok({
      requiresConfirmation: {
        recurringNames: plan.cascadingRecurring,
        performanceTotalCents: plan.performanceTotalCents,
      },
    });
  }

  // Performances cascade with the line item (FK `onDelete: "cascade"`) — nothing further to
  // clean up here, unlike documents/storage, since a performance is just a number, not a
  // stored file.
  await db
    .delete(lineItems)
    .where(and(eq(lineItems.id, id), eq(lineItems.orgId, current.orgId)));

  revalidateAll();
  return ok({});
}

/** Persist a new display order; the order drives documents as well as screens. */
export async function reorderLineItemsAction(orderedIds: string[]): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  if (orderedIds.length === 0 || !orderedIds.every(isUuid)) {
    return fail("That list is out of date — reload the page.");
  }

  const owned = await db
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(and(eq(lineItems.orgId, current.orgId), inArray(lineItems.id, orderedIds)));

  // Reject the whole reorder if the client sent an id from another organisation or a
  // stale list, rather than silently applying a partial order.
  if (owned.length !== orderedIds.length) return fail("That list is out of date — reload the page.");

  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(lineItems)
        .set({ sortOrder: index })
        .where(and(eq(lineItems.id, id), eq(lineItems.orgId, current.orgId)));
    }
  });

  revalidateAll();
  return ok();
}

/**
 * Add a performance to a line item (m08).
 *
 * Just an amount — no label or date. It rolls straight into `scheduledValueCents` via
 * `loadLineItemBudgets`, so every screen and document that already reads that number picks it
 * up without change.
 */
export async function addLineItemPerformanceAction(
  lineItemId: string,
  amount: string,
): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(lineItemId)) return fail("That line item no longer exists.");

  const amountCents = parseMoneyToCents(amount);
  if (amountCents === null || amountCents <= 0) return fail("Enter a performance amount.");

  const owned = await db
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(and(eq(lineItems.id, lineItemId), eq(lineItems.orgId, current.orgId)))
    .limit(1);
  if (owned.length === 0) return fail("That line item no longer exists.");

  const [{ value: maxSort }] = await db
    .select({ value: sql<number>`coalesce(max(${lineItemPerformances.sortOrder}), -1)` })
    .from(lineItemPerformances)
    .where(eq(lineItemPerformances.lineItemId, lineItemId));

  await db.insert(lineItemPerformances).values({
    orgId: current.orgId,
    lineItemId,
    amountCents,
    sortOrder: Number(maxSort) + 1,
  });

  revalidateAll();
  return ok();
}

/** Remove one performance entry — a typo'd amount is corrected by deleting and re-adding. */
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
