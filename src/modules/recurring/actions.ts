"use server";

/**
 * Recurring items (m05) — the fixed monthly set, added on confirmation only (R8.3).
 */
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import {
  expenseDocuments,
  expenses,
  fundingSources,
  lineItems,
  paymentSources,
  recurringItems,
  vendorDefaults,
} from "@/src/db/schema";
import { isValidMonthKey, monthLabel, todayIso } from "@/src/domain/dates";
import { parseMoneyToCents } from "@/src/domain/money";
import { addedState, validateRecurring } from "@/src/domain/recurring-rules";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { isUuid } from "@/src/lib/ids";
import { rulesForFundingSource } from "@/src/modules/expenses/reimbursement";
import { claimReferenceSeq } from "@/src/modules/expenses/references";
import { monthLocked } from "@/src/modules/packet/month-guard";


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
    .select({ id: lineItems.id, archivedAt: fundingSources.archivedAt })
    .from(lineItems)
    .innerJoin(fundingSources, eq(fundingSources.id, lineItems.fundingSourceId))
    .where(and(eq(lineItems.id, input.lineItemId), eq(lineItems.orgId, current.orgId)))
    .limit(1);
  if (owned.length === 0) return fail("Choose a line item.");
  // A template exists to create new expenses, which an archived source no longer takes (D-93).
  if (owned[0].archivedAt) return fail("That funding source is archived.");

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
      fundingSourceId: lineItems.fundingSourceId,
      sourceArchivedAt: fundingSources.archivedAt,
      defaultDescription: recurringItems.defaultDescription,
      defaultNarrative: recurringItems.defaultNarrative,
      defaultPaymentSource: recurringItems.defaultPaymentSource,
      defaultTaxCents: recurringItems.defaultTaxCents,
      defaultFeesCents: recurringItems.defaultFeesCents,
    })
    .from(recurringItems)
    .innerJoin(lineItems, eq(lineItems.id, recurringItems.lineItemId))
    .innerJoin(fundingSources, eq(fundingSources.id, lineItems.fundingSourceId))
    .where(and(eq(recurringItems.id, id), eq(recurringItems.orgId, current.orgId)))
    .limit(1);
  const item = rows[0];
  if (!item) return fail("That recurring item no longer exists.");
  // Same rule as createExpenseAction: an archived source takes no new expenses (D-93).
  if (item.sourceArchivedAt) return fail("That funding source is archived.");

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

  // A remembered source is only used while it is still one the organisation offers (R5.2).
  const paymentSource =
    (item.defaultPaymentSource && activeSources.includes(item.defaultPaymentSource)
      ? item.defaultPaymentSource
      : null) ??
    defaultSource?.label ??
    "Paid by us, reimbursement requested";

  // Deliberately not filtered on `deletedAt`: see the same counter in
  // `createExpenseAction` — a trashed row keeps its sortOrder.
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${expenses.sortOrder}), -1) + 1` })
    .from(expenses)
    .where(and(eq(expenses.orgId, current.orgId), eq(expenses.month, month)));

  // The funding source decides what it reimburses, so a one-click add must resolve the same
  // rules the expense form does (D-67, Phase 4/D-93 — no longer the payment source). Falling
  // through to the column defaults meant the identical expense claimed a different amount
  // depending on how it was entered.
  const rules = await rulesForFundingSource(current.orgId, item.fundingSourceId);

  // The insert and its reference claim must land together — a refused insert must never spend
  // the month's next reference number (plan §3.4, the same non-atomicity createExpenseAction
  // already avoids).
  const result = await db.transaction(async (tx) => {
    // First thing inside the transaction, before any write and before claimReferenceSeq
    // (R10.7, D-96).
    const locked = await monthLocked(tx, current.orgId, [
      { fundingSourceId: item.fundingSourceId, month },
    ]);
    if (locked) return { ok: false as const, locked };

    await tx.insert(expenses).values({
      orgId: current.orgId,
      lineItemId: item.lineItemId,
      fundingSourceId: item.fundingSourceId,
      month,
      date: todayIso(),
      name: item.name,
      description: item.defaultDescription ?? vendor?.description ?? "",
      // The narrative is the whole point of carrying a template forward: it arrives filled in
      // and editable, so nobody reopens last month to copy and paste it (R8.3).
      narrative: item.defaultNarrative,
      // A remembered source is only offered while it is still one the organisation uses (R5.2).
      paymentSource,
      subtotalCents: item.amountCents,
      taxCents: item.defaultTaxCents ?? 0,
      feesCents: item.defaultFeesCents ?? 0,
      taxReimbursable: rules.taxReimbursable,
      feesReimbursable: rules.feesReimbursable,
      sortOrder: Number(next),
      // R2.6: a one-click add is an expense like any other and needs the month's next
      // reference. Omitting this left every added row at the column default, so the second
      // add into a month collided on `expenses_org_month_reference_uq` and failed.
      referenceSeq: await claimReferenceSeq(current.orgId, item.fundingSourceId, month, tx),
      recurringItemId: id,
    });
    return { ok: true as const };
  });
  if (!result.ok) return fail(UI.monthLocked(monthLabel(result.locked.month)));

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Undo an add. Targets the newest expense this recurring item actually created (the
 * `recurringItemId` link), and refuses without confirmation when that expense already
 * carries documents, so a one-click undo cannot silently discard uploaded evidence.
 *
 * Deliberately refuses outright — no confirmation offered at all — when the only match is a
 * name-and-line-item coincidence rather than a real link: that is someone's own hand-typed
 * record, and marking something recurring must never be able to move or remove it. This used
 * to be a confirmation dialog instead of a refusal, which still let a confirmed "Remove
 * anyway" delete the record (first permanently, then — even after that was softened to a
 * trash entry — still out of its month). Confirmed live: Metro Parking, $180, May 2026.
 */
export async function removeRecurringFromMonthAction(
  id: string,
  month: string,
  confirmed = false,
): Promise<ActionResult<{ requiresConfirmation?: string }>> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail("That recurring item no longer exists.");
  if (!isValidMonthKey(month)) return fail("That is not a valid month.");

  const rows = await db
    .select({
      name: recurringItems.name,
      lineItemId: recurringItems.lineItemId,
      // The template's funding source, through its line item (recurring items have no
      // funding_source_id column of their own — m05). Review fix: an expense created from
      // this template, then moved to another source by editing it, must not be reachable by
      // Remove here — it belongs to a different source's month now.
      fundingSourceId: lineItems.fundingSourceId,
    })
    .from(recurringItems)
    .innerJoin(lineItems, eq(lineItems.id, recurringItems.lineItemId))
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
    .where(
      and(
        eq(expenses.orgId, current.orgId),
        eq(expenses.fundingSourceId, item.fundingSourceId),
        eq(expenses.month, month),
        isNull(expenses.deletedAt),
      ),
    )
    .groupBy(expenses.id);

  const state = addedState(item, monthRows, id);
  if (!state.added) return fail("That expense is already gone.");

  if (!state.createdByThisItem) {
    return fail(
      `The ${item.name} expense in this month wasn't added from this recurring item, so Remove can't touch it. Delete it from the Expenses list if you meant to remove it.`,
    );
  }
  if (!state.targetExpenseId) return fail("That expense is already gone.");

  if (state.requiresConfirmation && !confirmed) {
    const target = monthRows.find((row) => row.id === state.targetExpenseId)!;
    return ok({ requiresConfirmation: String(target.documentCount) });
  }

  // A trash-recoverable soft delete, exactly like the Delete button on the expenses list —
  // this used to hard-delete the row with no way back. Soft delete also means the documents
  // are left alone here, the same as any other trashed expense: nothing to clean up in
  // storage on this path at all.
  const targetExpenseId = state.targetExpenseId;
  const result = await db.transaction(async (tx) => {
    // First thing inside the transaction, before any write (R10.7, D-96).
    const locked = await monthLocked(tx, current.orgId, [
      { fundingSourceId: item.fundingSourceId, month },
    ]);
    if (locked) return { ok: false as const, locked };

    const trashed = await tx
      .update(expenses)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(expenses.id, targetExpenseId),
          eq(expenses.orgId, current.orgId),
          isNull(expenses.deletedAt),
          // Matches only the row the guard above just checked — a move committing between the
          // reads above and the guard would otherwise still match here on id alone (R10.7,
          // D-96, PR #16 review).
          eq(expenses.month, month),
          eq(expenses.fundingSourceId, item.fundingSourceId),
        ),
      )
      .returning({ id: expenses.id });
    return { ok: true as const, trashed };
  });
  if (!result.ok) return fail(UI.monthLocked(monthLabel(result.locked.month)));
  if (result.trashed.length === 0) return fail("That expense just changed. Try again.");

  revalidatePath("/", "layout");
  return ok({});
}
