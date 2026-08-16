"use server";

/**
 * Recurring items (m05) — the fixed monthly set, added on confirmation only (R8.3).
 */
import { and, asc, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import {
  expenseDocuments,
  expenses,
  lineItems,
  paymentSources,
  recurringItems,
  vendorDefaults,
} from "@/src/db/schema";
import { isValidMonthKey, todayIso } from "@/src/domain/dates";
import { parseMoneyToCents } from "@/src/domain/money";
import { addedState, validateRecurring } from "@/src/domain/recurring-rules";
import { fail, ok, SESSION_EXPIRED, type ActionResult } from "@/src/lib/action-result";
import {
  requireSession,
  UnauthenticatedError,
  type SessionContext,
} from "@/src/services/auth/session";
import { deleteExpenseDocument } from "@/src/services/storage/documents";

async function session(): Promise<SessionContext | { expired: ActionResult<never> }> {
  try {
    return await requireSession();
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { expired: fail(SESSION_EXPIRED) };
    throw error;
  }
}

export async function saveRecurringItemAction(input: {
  id?: string;
  name: string;
  amount: string;
  lineItemId: string;
  defaultDescription: string;
}): Promise<ActionResult> {
  const current = await session();
  if ("expired" in current) return current.expired;

  const amountCents = parseMoneyToCents(input.amount);
  const invalid = validateRecurring({
    name: input.name,
    amountCents,
    lineItemId: input.lineItemId,
  });
  if (invalid) return fail(invalid);

  const owned = await db
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(and(eq(lineItems.id, input.lineItemId), eq(lineItems.orgId, current.orgId)))
    .limit(1);
  if (owned.length === 0) return fail("Choose a line item.");

  const values = {
    name: input.name.trim(),
    amountCents: amountCents as number,
    lineItemId: input.lineItemId,
    defaultDescription: input.defaultDescription.trim() || null,
  };

  if (input.id) {
    const updated = await db
      .update(recurringItems)
      .set(values)
      .where(and(eq(recurringItems.id, input.id), eq(recurringItems.orgId, current.orgId)))
      .returning({ id: recurringItems.id });
    if (updated.length === 0) return fail("That recurring item no longer exists.");
  } else {
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${recurringItems.sortOrder}), -1) + 1` })
      .from(recurringItems)
      .where(eq(recurringItems.orgId, current.orgId));

    await db
      .insert(recurringItems)
      .values({ orgId: current.orgId, ...values, sortOrder: Number(next) });
  }

  revalidatePath("/", "layout");
  return ok();
}

export async function deleteRecurringItemAction(id: string): Promise<ActionResult> {
  const current = await session();
  if ("expired" in current) return current.expired;

  // Deleting the list entry never touches expenses already recorded from it.
  const deleted = await db
    .delete(recurringItems)
    .where(and(eq(recurringItems.id, id), eq(recurringItems.orgId, current.orgId)))
    .returning({ id: recurringItems.id });
  if (deleted.length === 0) return fail("That recurring item no longer exists.");

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Add a recurring item to a month (R8.3).
 *
 * The created expense deliberately carries no documents: it is immediately
 * documentation-incomplete, which is what puts it on the packet's blocking list until the
 * user attaches the proof (R4.5).
 */
export async function addRecurringToMonthAction(
  id: string,
  month: string,
): Promise<ActionResult> {
  const current = await session();
  if ("expired" in current) return current.expired;
  if (!isValidMonthKey(month)) return fail("That is not a valid month.");

  const rows = await db
    .select({
      name: recurringItems.name,
      amountCents: recurringItems.amountCents,
      lineItemId: recurringItems.lineItemId,
      defaultDescription: recurringItems.defaultDescription,
    })
    .from(recurringItems)
    .where(and(eq(recurringItems.id, id), eq(recurringItems.orgId, current.orgId)))
    .limit(1);
  const item = rows[0];
  if (!item) return fail("That recurring item no longer exists.");

  // Fall back to the vendor library's description when the item has none of its own.
  const [vendor] = await db
    .select({ description: vendorDefaults.defaultDescription })
    .from(vendorDefaults)
    .where(
      and(
        eq(vendorDefaults.orgId, current.orgId),
        sql`lower(${vendorDefaults.name}) = lower(${item.name})`,
      ),
    )
    .limit(1);

  const [defaultSource] = await db
    .select({ label: paymentSources.label })
    .from(paymentSources)
    .where(and(eq(paymentSources.orgId, current.orgId), eq(paymentSources.active, true)))
    .orderBy(asc(paymentSources.sortOrder))
    .limit(1);

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${expenses.sortOrder}), -1) + 1` })
    .from(expenses)
    .where(and(eq(expenses.orgId, current.orgId), eq(expenses.month, month)));

  await db.insert(expenses).values({
    orgId: current.orgId,
    lineItemId: item.lineItemId,
    month,
    date: todayIso(),
    name: item.name,
    description: item.defaultDescription ?? vendor?.description ?? "",
    paymentSource: defaultSource?.label ?? "Paid by us, reimbursement requested",
    subtotalCents: item.amountCents,
    sortOrder: Number(next),
  });

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Undo an add. Targets the newest matching expense, and refuses without confirmation when
 * that expense already carries documents, so a one-click undo cannot silently discard
 * uploaded evidence.
 */
export async function removeRecurringFromMonthAction(
  id: string,
  month: string,
  confirmed = false,
): Promise<ActionResult<{ requiresConfirmation?: string }>> {
  const current = await session();
  if ("expired" in current) return current.expired;
  if (!isValidMonthKey(month)) return fail("That is not a valid month.");

  const rows = await db
    .select({ name: recurringItems.name, lineItemId: recurringItems.lineItemId })
    .from(recurringItems)
    .where(and(eq(recurringItems.id, id), eq(recurringItems.orgId, current.orgId)))
    .limit(1);
  const item = rows[0];
  if (!item) return fail("That recurring item no longer exists.");

  const monthRows = await db
    .select({
      id: expenses.id,
      name: expenses.name,
      lineItemId: expenses.lineItemId,
      sortOrder: expenses.sortOrder,
      documentCount: count(expenseDocuments.id),
    })
    .from(expenses)
    .leftJoin(expenseDocuments, eq(expenseDocuments.expenseId, expenses.id))
    .where(and(eq(expenses.orgId, current.orgId), eq(expenses.month, month)))
    .groupBy(expenses.id);

  const state = addedState(item, monthRows);
  if (!state.added || !state.targetExpenseId) return fail("That expense is already gone.");
  if (state.requiresConfirmation && !confirmed) {
    const target = monthRows.find((row) => row.id === state.targetExpenseId)!;
    return ok({ requiresConfirmation: String(target.documentCount) });
  }

  const documents = await db
    .select({ id: expenseDocuments.id })
    .from(expenseDocuments)
    .where(eq(expenseDocuments.expenseId, state.targetExpenseId));

  await db
    .delete(expenses)
    .where(and(eq(expenses.id, state.targetExpenseId), eq(expenses.orgId, current.orgId)));

  for (const document of documents) {
    await deleteExpenseDocument(current.orgId, document.id);
  }

  revalidatePath("/", "layout");
  return ok({});
}
