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
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { deleteExpenseDocument } from "@/src/services/storage/documents";
import { isUuid } from "@/src/lib/ids";
import { claimReferenceSeq } from "@/src/modules/expenses/references";


export async function saveRecurringItemAction(input: {
  id?: string;
  name: string;
  amount: string;
  lineItemId: string;
  defaultDescription: string;
  defaultNarrative: string;
  defaultPaymentSource: string;
  defaultTax: string;
  defaultFees: string;
}): Promise<ActionResult> {
  const current = await actionSession();
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
    // Everything the client listed as "other recurring information" (R8.3). Blank clears the
    // stored value: on this screen the field IS the template, so emptying it is deliberate —
    // unlike the write-back from an expense, which never clears.
    defaultNarrative: input.defaultNarrative.trim() || null,
    defaultPaymentSource: input.defaultPaymentSource.trim() || null,
    defaultTaxCents: parseMoneyToCents(input.defaultTax),
    defaultFeesCents: parseMoneyToCents(input.defaultFees),
  };

  if (input.id) {
    // As above: a non-UUID must fail as "not found", not as an unhandled database error.
    if (!isUuid(input.id)) return fail("That recurring item no longer exists.");
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
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail("That recurring item no longer exists.");

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
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail("That recurring item no longer exists.");
  if (!isValidMonthKey(month)) return fail("That is not a valid month.");

  const rows = await db
    .select({
      name: recurringItems.name,
      amountCents: recurringItems.amountCents,
      lineItemId: recurringItems.lineItemId,
      defaultDescription: recurringItems.defaultDescription,
      defaultNarrative: recurringItems.defaultNarrative,
      defaultPaymentSource: recurringItems.defaultPaymentSource,
      defaultTaxCents: recurringItems.defaultTaxCents,
      defaultFeesCents: recurringItems.defaultFeesCents,
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

  const sources = await db
    .select({ label: paymentSources.label })
    .from(paymentSources)
    .where(and(eq(paymentSources.orgId, current.orgId), eq(paymentSources.active, true)))
    .orderBy(asc(paymentSources.sortOrder));
  const activeSources = sources.map((row) => row.label);
  const [defaultSource] = sources;

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
    // The narrative is the whole point of carrying a template forward: it arrives filled in
    // and editable, so nobody reopens last month to copy and paste it (R8.3).
    narrative: item.defaultNarrative,
    // A remembered source is only offered while it is still one the organisation uses (R5.2).
    paymentSource:
      (item.defaultPaymentSource && activeSources.includes(item.defaultPaymentSource)
        ? item.defaultPaymentSource
        : null) ??
      defaultSource?.label ??
      "Paid by us, reimbursement requested",
    subtotalCents: item.amountCents,
    taxCents: item.defaultTaxCents ?? 0,
    feesCents: item.defaultFeesCents ?? 0,
    sortOrder: Number(next),
    // R2.6: a one-click add is an expense like any other and needs the month's next
    // reference. Omitting this left every added row at the column default, so the second
    // add into a month collided on `expenses_org_month_reference_uq` and failed.
    referenceSeq: await claimReferenceSeq(current.orgId, month),
    recurringItemId: id,
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
): Promise<ActionResult<{ requiresConfirmation?: string; createdByThisItem?: boolean }>> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail("That recurring item no longer exists.");
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
      recurringItemId: expenses.recurringItemId,
      documentCount: count(expenseDocuments.id),
    })
    .from(expenses)
    .leftJoin(expenseDocuments, eq(expenseDocuments.expenseId, expenses.id))
    .where(and(eq(expenses.orgId, current.orgId), eq(expenses.month, month)))
    .groupBy(expenses.id);

  // Prefer expenses this recurring item actually created. Name matching remains as a
  // fallback for rows added before the link existed, but it must never be the first
  // choice: it can point at a manually entered expense that merely shares a payee.
  const state = addedState(item, monthRows, id);
  if (!state.added || !state.targetExpenseId) return fail("That expense is already gone.");
  if (state.requiresConfirmation && !confirmed) {
    const target = monthRows.find((row) => row.id === state.targetExpenseId)!;
    // The client words the question differently when the expense was typed by hand rather
    // than added from here, so it needs to know which case this is.
    return ok({
      requiresConfirmation: String(target.documentCount),
      createdByThisItem: state.createdByThisItem,
    });
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
