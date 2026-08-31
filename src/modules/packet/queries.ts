import "server-only";

/**
 * Everything the Month-End Packet screen reads (m06).
 *
 * The page-count listing is built from the same ordering and estimation the assembler uses,
 * so the contents the user reads before downloading describe the file they get.
 */
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/src/db";
import { expenseDocuments, expenses, lineItems, monthDocuments, monthStatuses } from "@/src/db/schema";
import type { MonthDocumentCategory } from "@/src/db/schema";
import { coverSheetRows } from "@/src/domain/cover-sheet";
import { blockingLabel, documentationStatus, type GateExpense } from "@/src/domain/gate";
import { reimbursableCents } from "@/src/domain/money";
import { estimateCoverSheetPages, estimateUploadPages } from "@/src/generation/page-estimate";

export type ReadinessRow = {
  lineItemId: string;
  name: string;
  amountCents: number;
  recordCount: number;
  /** Null when the line item has no records this month — the screen shows "—", not "No". */
  complete: boolean | null;
  estimatedPages: number;
};

export type BlockingRow = {
  expenseId: string;
  label: string;
};

export type MonthDocumentRow = {
  id: string;
  category: MonthDocumentCategory;
  title: string | null;
  filename: string;
  pageCount: number | null;
};

export type PacketReadiness = {
  rows: ReadinessRow[];
  blocking: BlockingRow[];
  totalAmountCents: number;
  totalRecords: number;
  documents: MonthDocumentRow[];
  /** Section 1 is one page unless the line item roster overflows. */
  summaryPages: number;
  /** The expense index that follows the summary (R2.6). */
  indexPages: number;
  monthDocumentPages: number;
  totalPages: number;
  submittedAt: Date | null;
  hasBankStatement: boolean;
};

/** Readiness, blocking list, month documents and live page counts for one month. */
export async function loadPacketReadiness(
  orgId: string,
  month: string,
): Promise<PacketReadiness> {
  const [items, rows, documents, docs, status] = await Promise.all([
    db
      .select({ id: lineItems.id, name: lineItems.name })
      .from(lineItems)
      .where(eq(lineItems.orgId, orgId))
      .orderBy(asc(lineItems.sortOrder), asc(lineItems.name), asc(lineItems.id)),
    db
      .select({
        id: expenses.id,
        lineItemId: expenses.lineItemId,
        lineItemName: lineItems.name,
        name: expenses.name,
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
      .where(and(eq(expenses.orgId, orgId), eq(expenses.month, month)))
      .orderBy(asc(expenses.sortOrder), asc(expenses.id)),
    db
      .select({
        expenseId: expenseDocuments.expenseId,
        kind: expenseDocuments.kind,
        status: expenseDocuments.status,
        pageCount: expenseDocuments.pageCount,
        widthPx: expenseDocuments.widthPx,
        heightPx: expenseDocuments.heightPx,
      })
      .from(expenseDocuments)
      .innerJoin(expenses, eq(expenses.id, expenseDocuments.expenseId))
      .where(and(eq(expenseDocuments.orgId, orgId), eq(expenses.month, month)))
      .orderBy(asc(expenseDocuments.sortOrder), asc(expenseDocuments.id)),
    db
      .select({
        id: monthDocuments.id,
        category: monthDocuments.category,
        title: monthDocuments.title,
        filename: monthDocuments.filename,
        pageCount: monthDocuments.pageCount,
        status: monthDocuments.status,
        sortOrder: monthDocuments.sortOrder,
      })
      .from(monthDocuments)
      .where(and(eq(monthDocuments.orgId, orgId), eq(monthDocuments.month, month)))
      .orderBy(asc(monthDocuments.sortOrder), asc(monthDocuments.id)),
    db
      .select({ submittedAt: monthStatuses.submittedAt })
      .from(monthStatuses)
      .where(and(eq(monthStatuses.orgId, orgId), eq(monthStatuses.month, month)))
      .limit(1),
  ]);

  const byExpense = new Map<string, typeof documents>();
  for (const document of documents) {
    const list = byExpense.get(document.expenseId) ?? [];
    list.push(document);
    byExpense.set(document.expenseId, list);
  }

  const blocking: BlockingRow[] = [];
  const readiness: ReadinessRow[] = [];
  let totalAmountCents = 0;

  for (const item of items) {
    const own = rows.filter((row) => row.lineItemId === item.id);
    const amountCents = own.reduce((sum, row) => sum + reimbursableCents(row), 0);
    totalAmountCents += amountCents;

    let complete = own.length > 0;
    for (const expense of own) {
      const attached = (byExpense.get(expense.id) ?? []).filter(
        (document) => document.status === "attached",
      );
      const gate: GateExpense = {
        id: expense.id,
        name: expense.name,
        lineItemName: expense.lineItemName,
        noReceipt: expense.noReceipt,
        documents: attached.map((document) => ({
          kind: document.kind,
          status: "attached" as const,
        })),
      };
      const state = documentationStatus(gate);
      if (!state.complete) {
        complete = false;
        // The canonical wording, so this list is identical to the expenses strip and to
        // what the download routes refuse with (R4.4).
        blocking.push({ expenseId: expense.id, label: blockingLabel(gate, state.missing!) });
      }
    }

    // Cover sheet pages, plus one page per receipt/supporting page (R11.3: proofs are
    // inside the cover sheet and are not counted again).
    const composed = coverSheetRows(own);
    const coverPages =
      own.length === 0
        ? 0
        : estimateCoverSheetPages(
            composed.rows.map((row, index) => ({
              role: row.role,
              notes: row.notes,
              narrative: row.narrative,
              proofs: (byExpense.get(own[index].id) ?? [])
                .filter((document) => document.kind === "proof" && document.status === "attached")
                .flatMap((document) =>
                  // A multi-page PDF proof contributes one image per page.
                  Array.from({ length: document.pageCount ?? 1 }, () => ({
                    widthPx: document.widthPx ?? 1275,
                    heightPx: document.heightPx ?? 1650,
                  })),
                ),
            })),
          );

    const attachmentPages = own.reduce(
      (sum, expense) =>
        sum +
        estimateUploadPages(
          (byExpense.get(expense.id) ?? []).filter(
            (document) =>
              document.status === "attached" &&
              (document.kind === "receipt" || document.kind === "supporting"),
          ),
        ),
      0,
    );

    readiness.push({
      lineItemId: item.id,
      name: item.name,
      amountCents,
      recordCount: own.length,
      complete: own.length === 0 ? null : complete,
      estimatedPages: coverPages + attachmentPages,
    });
  }

  const attachedDocs = docs.filter((row) => row.status === "attached");
  const monthDocumentPages = estimateUploadPages(attachedDocs);
  // One page unless the roster overflows, which is what the assembler does too.
  const summaryPages = items.length > 22 ? Math.ceil(items.length / 22) : 1;
  // The index lists one row per expense. 33 rows clear the title block on the first page and
  // ~38 fit on a continuation, so the first page is the binding one — and it is never zero,
  // because the section prints "This month has no expenses." rather than being skipped.
  const INDEX_ROWS_PER_PAGE = 33;
  const indexPages = Math.max(1, Math.ceil(rows.length / INDEX_ROWS_PER_PAGE));

  return {
    rows: readiness,
    blocking,
    totalAmountCents,
    totalRecords: rows.length,
    documents: attachedDocs.map((row) => ({
      id: row.id,
      category: row.category,
      title: row.title,
      filename: row.filename,
      pageCount: row.pageCount,
    })),
    summaryPages,
    indexPages,
    monthDocumentPages,
    totalPages:
      summaryPages +
      indexPages +
      monthDocumentPages +
      readiness.reduce((sum, row) => sum + row.estimatedPages, 0),
    submittedAt: status[0]?.submittedAt ?? null,
    hasBankStatement: attachedDocs.some((row) => row.category === "bank_statement"),
  };
}
