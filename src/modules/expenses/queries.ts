import "server-only";

/**
 * Expense reads for m02 and m03.
 */
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/src/db";
import { isUuid } from "@/src/lib/ids";
import {
  expenseDocuments,
  expenses,
  lineItems,
  paymentSources,
  supportingDocTypes,
} from "@/src/db/schema";
import type { DocumentKind } from "@/src/db/schema";
import { reimbursableCents } from "@/src/domain/money";

export type AttachedDocument = {
  id: string;
  kind: DocumentKind;
  supportingType: string | null;
  filename: string;
  mimeType: string;
  pageCount: number | null;
  status: "pending" | "attached" | "failed";
};

export type ExpenseDetail = {
  id: string;
  name: string;
  lineItemId: string;
  lineItemName: string;
  paymentSource: string;
  month: string;
  date: string;
  description: string;
  subtotalCents: number;
  taxCents: number;
  feesCents: number;
  taxReimbursable: boolean;
  feesReimbursable: boolean;
  note: string | null;
  narrative: string | null;
  noReceipt: boolean;
  noReceiptReason: string | null;
  sortOrder: number;
  /** Numbered within its month; rendered through `expenseReference` (R2.6). */
  referenceSeq: number;
  documents: AttachedDocument[];
};

/** Options the expense form needs: line items and the org's active label lists. */
export async function loadExpenseFormOptions(orgId: string) {
  const [items, sources, docTypes] = await Promise.all([
    db
      .select({ id: lineItems.id, name: lineItems.name })
      .from(lineItems)
      .where(eq(lineItems.orgId, orgId))
      .orderBy(asc(lineItems.sortOrder), asc(lineItems.name)),
    db
      .select({
        label: paymentSources.label,
        taxReimbursable: paymentSources.taxReimbursable,
        feesReimbursable: paymentSources.feesReimbursable,
      })
      .from(paymentSources)
      .where(and(eq(paymentSources.orgId, orgId), eq(paymentSources.active, true)))
      .orderBy(asc(paymentSources.sortOrder)),
    db
      .select({ label: supportingDocTypes.label })
      .from(supportingDocTypes)
      .where(and(eq(supportingDocTypes.orgId, orgId), eq(supportingDocTypes.active, true)))
      .orderBy(asc(supportingDocTypes.sortOrder)),
  ]);

  return {
    lineItems: items,
    paymentSources: sources.map((row) => row.label),
    /**
     * Each funder's reimbursement rules, so choosing a payment source sets the flags rather
     * than leaving them to be re-decided on every expense (R1.3, D-67).
     */
    reimbursementRules: Object.fromEntries(
      sources.map((row) => [
        row.label,
        { taxReimbursable: row.taxReimbursable, feesReimbursable: row.feesReimbursable },
      ]),
    ),
    supportingDocTypes: docTypes.map((row) => row.label),
  };
}

async function documentsFor(orgId: string, expenseIds: string[]): Promise<Map<string, AttachedDocument[]>> {
  if (expenseIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: expenseDocuments.id,
      expenseId: expenseDocuments.expenseId,
      kind: expenseDocuments.kind,
      supportingType: expenseDocuments.supportingType,
      filename: expenseDocuments.filename,
      mimeType: expenseDocuments.mimeType,
      pageCount: expenseDocuments.pageCount,
      status: expenseDocuments.status,
    })
    .from(expenseDocuments)
    .where(eq(expenseDocuments.orgId, orgId))
    .orderBy(asc(expenseDocuments.kind), asc(expenseDocuments.sortOrder));

  const byExpense = new Map<string, AttachedDocument[]>();
  const wanted = new Set(expenseIds);
  for (const row of rows) {
    if (!wanted.has(row.expenseId)) continue;
    const list = byExpense.get(row.expenseId) ?? [];
    list.push(row);
    byExpense.set(row.expenseId, list);
  }
  return byExpense;
}

/** One expense with its documents, org-scoped. */
export async function loadExpense(orgId: string, id: string): Promise<ExpenseDetail | null> {
  // Ids arrive from route parameters, where anything can be typed. Comparing a non-UUID
  // against a uuid column raises a Postgres 22P02 that reaches the page as a 500; "not
  // found" is both the truth and what a probe should learn. Guarded here rather than in each
  // caller so a new page cannot forget it.
  if (!isUuid(id)) return null;

  const rows = await db
    .select({
      id: expenses.id,
      name: expenses.name,
      lineItemId: expenses.lineItemId,
      lineItemName: lineItems.name,
      paymentSource: expenses.paymentSource,
      month: expenses.month,
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
      sortOrder: expenses.sortOrder,
      referenceSeq: expenses.referenceSeq,
    })
    .from(expenses)
    .innerJoin(lineItems, eq(lineItems.id, expenses.lineItemId))
    .where(and(eq(expenses.id, id), eq(expenses.orgId, orgId), isNull(expenses.deletedAt)))
    .limit(1);

  const expense = rows[0];
  if (!expense) return null;

  const documents = await documentsFor(orgId, [expense.id]);
  return { ...expense, documents: documents.get(expense.id) ?? [] };
}

/** Every expense in a month, in entry order, with documents attached (m03). */
export async function loadMonthExpenses(orgId: string, month: string): Promise<ExpenseDetail[]> {
  const rows = await db
    .select({
      id: expenses.id,
      name: expenses.name,
      lineItemId: expenses.lineItemId,
      lineItemName: lineItems.name,
      paymentSource: expenses.paymentSource,
      month: expenses.month,
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
      sortOrder: expenses.sortOrder,
      referenceSeq: expenses.referenceSeq,
    })
    .from(expenses)
    .innerJoin(lineItems, eq(lineItems.id, expenses.lineItemId))
    .where(and(eq(expenses.orgId, orgId), eq(expenses.month, month), isNull(expenses.deletedAt)))
    .orderBy(asc(expenses.sortOrder));

  const documents = await documentsFor(
    orgId,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({ ...row, documents: documents.get(row.id) ?? [] }));
}

/** One trashed expense, as much of it as the Trash screen shows. */
export type TrashedExpense = {
  id: string;
  name: string;
  month: string;
  lineItemName: string;
  amountCents: number;
  deletedAt: Date;
  // Soft delete leaves documents attached (they only go away on permanent delete), so the
  // trash can show what would be restored or lost, the same as the active list does.
  documents: AttachedDocument[];
};

/** Everything currently in the trash, newest deletion first. All months, no scoping. */
export async function loadTrashedExpenses(orgId: string): Promise<TrashedExpense[]> {
  const rows = await db
    .select({
      id: expenses.id,
      name: expenses.name,
      month: expenses.month,
      lineItemName: lineItems.name,
      subtotalCents: expenses.subtotalCents,
      taxCents: expenses.taxCents,
      feesCents: expenses.feesCents,
      taxReimbursable: expenses.taxReimbursable,
      feesReimbursable: expenses.feesReimbursable,
      deletedAt: expenses.deletedAt,
    })
    .from(expenses)
    .innerJoin(lineItems, eq(lineItems.id, expenses.lineItemId))
    .where(and(eq(expenses.orgId, orgId), isNotNull(expenses.deletedAt)))
    .orderBy(desc(expenses.deletedAt));

  const documents = await documentsFor(orgId, rows.map((row) => row.id));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    month: row.month,
    lineItemName: row.lineItemName,
    amountCents: reimbursableCents(row),
    // Narrowed by the WHERE above: every row here has a `deletedAt` already.
    deletedAt: row.deletedAt!,
    documents: documents.get(row.id) ?? [],
  }));
}
