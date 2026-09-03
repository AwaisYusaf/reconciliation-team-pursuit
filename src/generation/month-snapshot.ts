import "server-only";

/**
 * The month snapshot every generator works from.
 *
 * Generators are pure `(data) => bytes`: they never touch the database. One query layer
 * assembles everything a month needs, which keeps the generators trivially testable
 * against fixtures and guarantees the cover sheet, the workbook and the packet are all
 * describing the same instant.
 */
import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";

import { db } from "@/src/db";
import {
  contractSettings,
  expenseDocuments,
  expenses,
  lineItems,
  monthDocuments,
  organizations,
} from "@/src/db/schema";
import type { DocumentKind, MonthDocumentCategory } from "@/src/db/schema";
import type { ExpenseAmount, LineItemBudget } from "@/src/domain/budget-math";
import type { MonthKey } from "@/src/domain/dates";
import type { GateExpense } from "@/src/domain/gate";
import type { ContractSettingsInput } from "@/src/domain/summary";

export type SnapshotDocument = {
  id: string;
  kind: DocumentKind;
  supportingType: string | null;
  s3Key: string;
  filename: string;
  mimeType: string;
  pageCount: number | null;
  widthPx: number | null;
  heightPx: number | null;
  sizeBytes: number;
  sortOrder: number;
};

export type SnapshotExpense = {
  id: string;
  lineItemId: string;
  lineItemName: string;
  name: string;
  description: string;
  date: string;
  paymentSource: string;
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
  /** Numbered within the month; printed in the packet's expense index (R2.6). */
  referenceSeq: number;
  documents: SnapshotDocument[];
};

export type SnapshotMonthDocument = {
  id: string;
  category: MonthDocumentCategory;
  title: string | null;
  s3Key: string;
  filename: string;
  mimeType: string;
  pageCount: number | null;
  widthPx: number | null;
  heightPx: number | null;
  sizeBytes: number;
  sortOrder: number;
};

export type MonthSnapshot = {
  orgId: string;
  /** Name printed on documents (R6.1, R10.3). */
  docName: string;
  month: MonthKey;
  lineItems: LineItemBudget[];
  /** This month's expenses, in entry order, with their documents. */
  expenses: SnapshotExpense[];
  /** Amounts up to and including this month, for the budget maths (R3). */
  amounts: ExpenseAmount[];
  monthDocuments: SnapshotMonthDocument[];
  settings: ContractSettingsInput & {
    projectName: string;
    contractNumber: string;
    basePoNumber: string;
    performancePoNumber: string;
    fiduciaryName: string;
  };
};

const EMPTY_SETTINGS = {
  contractValueCents: 0,
  perfGrantScheduledCents: 0,
  perfGrantBilledCents: 0,
  advancesReceivedCents: 0,
  projectName: "",
  contractNumber: "",
  basePoNumber: "",
  performancePoNumber: "",
  fiduciaryName: "",
};

/**
 * Everything the generators need for one month, org-scoped.
 *
 * Read inside a single repeatable-read transaction. Issued as independent statements, an
 * expense added between two of them could land in the figures but not in the set the
 * documentation gate inspects — a workbook whose sheets disagree, for a month that should
 * have been refused (R4.3). One consistent read makes that unrepresentable.
 *
 * Every query carries a total ordering. The cache key is a hash of this structure and
 * `canonicalJson` treats array order as data, so a query free to return rows in any order
 * would change the hash whenever Postgres felt like rewriting a tuple, and R10.4's cache
 * would rebuild identical bytes forever.
 */
export async function loadMonthSnapshot(
  orgId: string,
  month: MonthKey,
): Promise<MonthSnapshot> {
  return db.transaction(
    async (tx) => {
      const org = await tx
        .select({ docName: organizations.docName })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      const items = await tx
        .select({
          id: lineItems.id,
          name: lineItems.name,
          scheduledValueCents: lineItems.scheduledValueCents,
          openingBilledCents: lineItems.openingBilledCents,
          sortOrder: lineItems.sortOrder,
        })
        .from(lineItems)
        .where(eq(lineItems.orgId, orgId))
        .orderBy(asc(lineItems.sortOrder), asc(lineItems.name), asc(lineItems.id));

      const monthExpenses = await tx
        .select({
          id: expenses.id,
          lineItemId: expenses.lineItemId,
          lineItemName: lineItems.name,
          name: expenses.name,
          description: expenses.description,
          date: expenses.date,
          paymentSource: expenses.paymentSource,
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
        .innerJoin(
          lineItems,
          and(eq(lineItems.id, expenses.lineItemId), eq(lineItems.orgId, orgId)),
        )
        .where(and(eq(expenses.orgId, orgId), eq(expenses.month, month), isNull(expenses.deletedAt)))
        .orderBy(asc(expenses.sortOrder), asc(expenses.id));

      // Only prior months are queried; this month's figures are derived from the rows above,
      // so the summary sheet, the detail sheet and the gate are the same set by construction
      // rather than by two queries agreeing (R10.2).
      const priorAmounts = await tx
        .select({
          lineItemId: expenses.lineItemId,
          month: expenses.month,
          subtotalCents: expenses.subtotalCents,
          taxCents: expenses.taxCents,
          feesCents: expenses.feesCents,
          taxReimbursable: expenses.taxReimbursable,
          feesReimbursable: expenses.feesReimbursable,
        })
        .from(expenses)
        .where(and(eq(expenses.orgId, orgId), lt(expenses.month, month), isNull(expenses.deletedAt)))
        .orderBy(asc(expenses.month), asc(expenses.id));

      const settings = await tx
        .select()
        .from(contractSettings)
        .where(eq(contractSettings.orgId, orgId))
        .limit(1);

      const docs = await tx
        .select()
        .from(monthDocuments)
        .where(and(eq(monthDocuments.orgId, orgId), eq(monthDocuments.month, month)))
        .orderBy(asc(monthDocuments.sortOrder), asc(monthDocuments.id));

      const expenseIds = monthExpenses.map((row) => row.id);
      const documents = expenseIds.length
        ? await tx
            .select({
              id: expenseDocuments.id,
              expenseId: expenseDocuments.expenseId,
              kind: expenseDocuments.kind,
              supportingType: expenseDocuments.supportingType,
              s3Key: expenseDocuments.s3Key,
              filename: expenseDocuments.filename,
              mimeType: expenseDocuments.mimeType,
              pageCount: expenseDocuments.pageCount,
              widthPx: expenseDocuments.widthPx,
              heightPx: expenseDocuments.heightPx,
              sizeBytes: expenseDocuments.sizeBytes,
              sortOrder: expenseDocuments.sortOrder,
              status: expenseDocuments.status,
            })
            .from(expenseDocuments)
            // Scoped to this month's expenses, not the whole organisation: an org at R13.1's
            // limits holds ~200k document rows, and every download would read all of them.
            .where(
              and(
                eq(expenseDocuments.orgId, orgId),
                inArray(expenseDocuments.expenseId, expenseIds),
              ),
            )
            .orderBy(asc(expenseDocuments.sortOrder), asc(expenseDocuments.id))
        : [];

      const byExpense = new Map<string, SnapshotDocument[]>();
      for (const row of documents) {
        // Only proven uploads reach a document (R4.6).
        if (row.status !== "attached") continue;
        const list = byExpense.get(row.expenseId) ?? [];
        list.push(row);
        byExpense.set(row.expenseId, list);
      }

      return {
        orgId,
        docName: org[0]?.docName ?? "",
        month,
        lineItems: items,
        expenses: monthExpenses.map((row) => ({
          ...row,
          documents: byExpense.get(row.id) ?? [],
        })),
        amounts: [
          ...priorAmounts,
          ...monthExpenses.map((row) => ({
            lineItemId: row.lineItemId,
            month,
            subtotalCents: row.subtotalCents,
            taxCents: row.taxCents,
            feesCents: row.feesCents,
            taxReimbursable: row.taxReimbursable,
            feesReimbursable: row.feesReimbursable,
          })),
        ],
        monthDocuments: docs
          .filter((row) => row.status === "attached")
          .map((row) => ({
            id: row.id,
            category: row.category,
            title: row.title,
            s3Key: row.s3Key,
            filename: row.filename,
            mimeType: row.mimeType,
            pageCount: row.pageCount,
            widthPx: row.widthPx,
            heightPx: row.heightPx,
            sizeBytes: row.sizeBytes,
            sortOrder: row.sortOrder,
          })),
        settings: settings[0]
          ? {
              contractValueCents: settings[0].contractValueCents,
              perfGrantScheduledCents: settings[0].perfGrantScheduledCents,
              perfGrantBilledCents: settings[0].perfGrantBilledCents,
              advancesReceivedCents: settings[0].advancesReceivedCents,
              projectName: settings[0].projectName,
              contractNumber: settings[0].contractNumber,
              basePoNumber: settings[0].basePoNumber,
              performancePoNumber: settings[0].performancePoNumber,
              fiduciaryName: settings[0].fiduciaryName,
            }
          : EMPTY_SETTINGS,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Expenses of one line item, in cover sheet order (R6.2). */
export function expensesForLineItem(
  snapshot: MonthSnapshot,
  lineItemId: string,
): SnapshotExpense[] {
  return snapshot.expenses.filter((expense) => expense.lineItemId === lineItemId);
}

/**
 * The month in the gate's vocabulary (R4.3).
 *
 * A snapshot only ever carries `attached` documents — the loader drops pending and failed
 * uploads because they are not evidence (R4.6) — so the status is restated here rather than
 * re-derived, keeping that invariant in one place.
 */
export function gateExpenses(expenses: readonly SnapshotExpense[]): GateExpense[] {
  return expenses.map((expense) => ({
    id: expense.id,
    name: expense.name,
    lineItemName: expense.lineItemName,
    noReceipt: expense.noReceipt,
    documents: expense.documents.map((document) => ({
      kind: document.kind as "proof" | "receipt" | "supporting",
      status: "attached" as const,
    })),
  }));
}
