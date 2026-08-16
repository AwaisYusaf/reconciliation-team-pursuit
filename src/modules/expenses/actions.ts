"use server";

/**
 * Expense capture (m02) — the single point where the packet's raw material is recorded.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import { expenseDocuments, expenses, lineItems, vendorDefaults } from "@/src/db/schema";
import { isValidIsoDate, isValidMonthKey, todayIso } from "@/src/domain/dates";
import { parseMoneyToCentsOrZero } from "@/src/domain/money";
import { UI } from "@/src/domain/strings";
import { fail, ok, SESSION_EXPIRED, type ActionResult } from "@/src/lib/action-result";
import {
  requireSession,
  UnauthenticatedError,
  type SessionContext,
} from "@/src/services/auth/session";
import { deleteExpenseDocument as removeStoredDocument } from "@/src/services/storage/documents";

async function session(): Promise<SessionContext | { expired: ActionResult<never> }> {
  try {
    return await requireSession();
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { expired: fail(SESSION_EXPIRED) };
    throw error;
  }
}

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

/** Validation shared by create and update, so both paths enforce the same rules. */
function validate(input: ExpenseInput): string | null {
  if (!input.name.trim() || !input.lineItemId || !input.paymentSource) {
    return UI.expenseMissingFields;
  }
  if (!isValidMonthKey(input.month)) return "Choose a month.";
  if (!isValidIsoDate(input.date)) return "Enter a valid date.";
  if (input.noReceipt && !input.noReceiptReason.trim()) return UI.noReceiptReasonRequired;
  return null;
}

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
 * The library learns from every save (R8.2): next time this payee is typed, its line item
 * and description are offered automatically.
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
    })
    .onConflictDoNothing();
}

export async function createExpenseAction(
  input: ExpenseInput,
): Promise<ActionResult<{ id: string }>> {
  const current = await session();
  if ("expired" in current) return current.expired;

  const invalid = validate(input);
  if (invalid) return fail(invalid);

  const owned = await db
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(and(eq(lineItems.id, input.lineItemId), eq(lineItems.orgId, current.orgId)))
    .limit(1);
  if (owned.length === 0) return fail("Choose a line item.");

  const row = toRow(input);

  // One monotonic counter per month keeps the flat list, the cover sheet rows and the
  // Excel grouping in one consistent order (data-model).
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${expenses.sortOrder}), -1) + 1` })
    .from(expenses)
    .where(and(eq(expenses.orgId, current.orgId), eq(expenses.month, row.month)));

  const [created] = await db
    .insert(expenses)
    .values({ orgId: current.orgId, ...row, sortOrder: Number(next) })
    .returning({ id: expenses.id });

  await learnVendor(current.orgId, row);
  revalidatePath("/", "layout");
  return ok({ id: created.id });
}

export async function updateExpenseAction(input: ExpenseInput): Promise<ActionResult> {
  const current = await session();
  if ("expired" in current) return current.expired;
  if (!input.id) return fail("That expense no longer exists.");

  const invalid = validate(input);
  if (invalid) return fail(invalid);

  const row = toRow(input);

  // "No receipt available" and attached receipts are mutually exclusive (R4.2): saving
  // with the box ticked removes the receipt files the user has confirmed away.
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

  const updated = await db
    .update(expenses)
    .set(row)
    .where(and(eq(expenses.id, input.id), eq(expenses.orgId, current.orgId)))
    .returning({ id: expenses.id });
  if (updated.length === 0) return fail("That expense no longer exists.");

  await learnVendor(current.orgId, row);
  revalidatePath("/", "layout");
  return ok();
}

export async function deleteExpenseAction(id: string): Promise<ActionResult> {
  const current = await session();
  if ("expired" in current) return current.expired;

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
  const current = await session();
  if ("expired" in current) return current.expired;

  const removed = await removeStoredDocument(current.orgId, documentId);
  if (!removed) return fail("That file is already gone.");

  revalidatePath("/", "layout");
  return ok();
}

/** Vendor autofill lookup (R8.1): exact match fills the form, partials are suggestions. */
export async function searchVendorsAction(
  query: string,
): Promise<ActionResult<Array<{ name: string; lineItemId: string | null; description: string }>>> {
  const current = await session();
  if ("expired" in current) return current.expired;

  const term = query.trim();
  if (term.length === 0) return ok([]);

  const rows = await db
    .select({
      name: vendorDefaults.name,
      lineItemId: vendorDefaults.defaultLineItemId,
      description: vendorDefaults.defaultDescription,
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

/** Today's date in the organisation's timezone, for the form's default (R2.5). */
export async function todayForOrgAction(): Promise<string> {
  return todayIso();
}
