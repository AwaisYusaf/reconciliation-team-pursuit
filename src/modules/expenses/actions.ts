"use server";

/**
 * Expense capture (m02) — the single point where the packet's raw material is recorded.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import { expenseDocuments, expenses, lineItems, monthStatuses, vendorDefaults } from "@/src/db/schema";
import { parseMoneyToCentsOrZero } from "@/src/domain/money";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { deleteExpenseDocument as removeStoredDocument } from "@/src/services/storage/documents";
import { isUuid } from "@/src/lib/ids";
import { isKnownPaymentSource } from "@/src/modules/settings/labels";

import { validate } from "./validation";

export type ExpenseInput = {
  id?: string;
  name: string;
  lineItemId: string;
  paymentSource: string;
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

function toRow(input: ExpenseInput) {
  return {
    name: input.name.trim(),
    lineItemId: input.lineItemId,
    paymentSource: input.paymentSource,
    month: input.month,
    date: input.date,
    description: input.description.trim(),
    subtotalCents: parseMoneyToCentsOrZero(input.subtotal),
    taxCents: parseMoneyToCentsOrZero(input.tax),
    feesCents: parseMoneyToCentsOrZero(input.fees),
    note: input.note.trim() || null,
    narrative: input.narrative.trim() || null,
    noReceipt: input.noReceipt,
    noReceiptReason: input.noReceipt ? input.noReceiptReason.trim() : null,
  };
}

/**
 * Claim the next reference number for a month (R2.6).
 *
 * One statement, so the counter is read and advanced under the same row lock: two saves in
 * the same month cannot be handed the same number, and nothing has to detect a collision and
 * retry. Deleting an expense leaves its number spent — a reference that has been printed is
 * never handed to something else.
 *
 * `month_statuses` gains a row here if the month has none. That is harmless: the only other
 * column is `submitted_at`, and a row with it null already means exactly what no row means.
 */
async function claimReferenceSeq(orgId: string, month: string): Promise<number> {
  const [claimed] = await db
    .insert(monthStatuses)
    .values({ orgId, month, nextReferenceSeq: 2 })
    .onConflictDoUpdate({
      target: [monthStatuses.orgId, monthStatuses.month],
      set: { nextReferenceSeq: sql`${monthStatuses.nextReferenceSeq} + 1` },
    })
    .returning({ next: monthStatuses.nextReferenceSeq });

  // The row now holds the *next* number, so the one just claimed is one below it.
  return Number(claimed.next) - 1;
}

/**
 * The library learns from every save (R8.2): next time this payee is typed, its line item,
 * description and last amounts are offered automatically.
 *
 * Amounts are stored as they were saved, including zero — a vendor that genuinely charges no
 * tax is a fact worth remembering, and is distinct from the null that means nothing has been
 * learned yet.
 */
async function learnVendor(orgId: string, row: ReturnType<typeof toRow>): Promise<void> {
  // Uniqueness is a lower(name) expression index, which Drizzle's typed onConflict cannot
  // target, so the upsert is explicit. Latest write wins (R8.2).
  const existing = await db
    .select({ id: vendorDefaults.id })
    .from(vendorDefaults)
    .where(
      and(
        eq(vendorDefaults.orgId, orgId),
        sql`lower(${vendorDefaults.name}) = lower(${row.name})`,
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(vendorDefaults)
      .set({
        name: row.name,
        defaultLineItemId: row.lineItemId,
        defaultDescription: row.description,
        defaultPaymentSource: row.paymentSource,
        defaultSubtotalCents: row.subtotalCents,
        defaultTaxCents: row.taxCents,
        defaultFeesCents: row.feesCents,
      })
      .where(eq(vendorDefaults.id, existing[0].id));
    return;
  }

  await db
    .insert(vendorDefaults)
    .values({
      orgId,
      name: row.name,
      defaultLineItemId: row.lineItemId,
      defaultDescription: row.description,
      defaultPaymentSource: row.paymentSource,
      defaultSubtotalCents: row.subtotalCents,
      defaultTaxCents: row.taxCents,
      defaultFeesCents: row.feesCents,
    })
    .onConflictDoNothing();
}

export async function createExpenseAction(
  input: ExpenseInput,
): Promise<ActionResult<{ id: string }>> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const invalid = validate(input);
  if (invalid) return fail(invalid);

  const owned = await db
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(and(eq(lineItems.id, input.lineItemId), eq(lineItems.orgId, current.orgId)))
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
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${expenses.sortOrder}), -1) + 1` })
    .from(expenses)
    .where(and(eq(expenses.orgId, current.orgId), eq(expenses.month, row.month)));

  const [created] = await db
    .insert(expenses)
    .values({
      orgId: current.orgId,
      ...row,
      sortOrder: Number(next),
      referenceSeq: await claimReferenceSeq(current.orgId, row.month),
    })
    .returning({ id: expenses.id });

  await learnVendor(current.orgId, row);
  revalidatePath("/", "layout");
  return ok({ id: created.id });
}

export async function updateExpenseAction(input: ExpenseInput): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!input.id) return fail("That expense no longer exists.");

  const invalid = validate(input);
  if (invalid) return fail(invalid);
  if (!isUuid(input.id)) return fail("That expense no longer exists.");

  // The line item must belong to this organisation. Without this check an update could
  // rebind an expense to another organisation's line item — a cross-tenant reference that
  // would then render that organisation's line item name on this one's screens.
  const ownsLineItem = await db
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(and(eq(lineItems.id, input.lineItemId), eq(lineItems.orgId, current.orgId)))
    .limit(1);
  if (ownsLineItem.length === 0) return fail("Choose a line item.");

  // An expense keeps the label it was saved with, even after that label is retired (R5.1,
  // R5.2). Re-validating an unchanged value would make every historical expense
  // uneditable the moment its payment source is deactivated — and the only way out would be
  // to overwrite the snapshot that already printed on a submitted cover sheet. Only a
  // *changed* label has to be one the organisation currently offers.
  const [existing] = await db
    .select({
      month: expenses.month,
      sortOrder: expenses.sortOrder,
      referenceSeq: expenses.referenceSeq,
      paymentSource: expenses.paymentSource,
    })
    .from(expenses)
    .where(and(eq(expenses.id, input.id), eq(expenses.orgId, current.orgId)))
    .limit(1);
  if (!existing) return fail("That expense no longer exists.");

  if (
    input.paymentSource !== existing.paymentSource &&
    !(await isKnownPaymentSource(current.orgId, input.paymentSource))
  ) {
    return fail("Choose a payment source.");
  }

  const row = toRow(input);

  // Moving an expense to another month must give it that month's next counter value,
  // otherwise it collides with a row already there and the packet ordering becomes
  // ambiguous (the counter is per month).

  let sortOrder = existing.sortOrder;
  if (existing.month !== row.month) {
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${expenses.sortOrder}), -1) + 1` })
      .from(expenses)
      .where(and(eq(expenses.orgId, current.orgId), eq(expenses.month, row.month)));
    sortOrder = Number(next);
  }

  // The reference names the packet the expense appears in, so a move to another month earns
  // that month's next number. Staying put keeps the number it was given — a reference that
  // changed under an already-printed packet would be worse than one that never moves.
  const movedMonth = existing.month !== row.month;
  // Captured so the narrowing from the guard above survives into the retry callback.
  const expenseId = input.id;
  const updated = await db
    .update(expenses)
    .set({
      ...row,
      sortOrder,
      ...(movedMonth ? { referenceSeq: await claimReferenceSeq(current.orgId, row.month) } : {}),
    })
    .where(and(eq(expenses.id, expenseId), eq(expenses.orgId, current.orgId)))
    .returning({ id: expenses.id });
  if (updated.length === 0) return fail("That expense no longer exists.");

  // "No receipt available" and attached receipts are mutually exclusive (R4.2): saving
  // with the box ticked removes the receipt files the user confirmed away. This runs only
  // after the update has proven the expense exists and is writable — deleting first would
  // destroy files irreversibly even when the save then failed.
  if (row.noReceipt) {
    const receipts = await db
      .select({ id: expenseDocuments.id })
      .from(expenseDocuments)
      .where(
        and(
          eq(expenseDocuments.expenseId, input.id),
          eq(expenseDocuments.orgId, current.orgId),
          eq(expenseDocuments.kind, "receipt"),
        ),
      );
    for (const receipt of receipts) {
      await removeStoredDocument(current.orgId, receipt.id);
    }
  }

  await learnVendor(current.orgId, row);
  revalidatePath("/", "layout");
  return ok();
}

export async function deleteExpenseAction(id: string): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail("That expense no longer exists.");

  const documents = await db
    .select({ id: expenseDocuments.id })
    .from(expenseDocuments)
    .where(and(eq(expenseDocuments.expenseId, id), eq(expenseDocuments.orgId, current.orgId)));

  const deleted = await db
    .delete(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.orgId, current.orgId)))
    .returning({ id: expenses.id });
  if (deleted.length === 0) return fail("That expense no longer exists.");

  // Rows cascade with the expense; the stored objects are removed best-effort here and
  // swept later if any deletion fails (data-model §Cleanup).
  for (const document of documents) {
    await removeStoredDocument(current.orgId, document.id);
  }

  revalidatePath("/", "layout");
  return ok();
}

/** Remove one attached file (immediate — the form warns that Cancel will not undo it). */
export async function removeExpenseDocumentAction(documentId: string): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(documentId)) return fail("That file is already gone.");

  const removed = await removeStoredDocument(current.orgId, documentId);
  if (!removed) return fail("That file is already gone.");

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

