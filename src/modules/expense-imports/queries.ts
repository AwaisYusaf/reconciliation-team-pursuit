import "server-only";

/**
 * Draft reads for the "Waiting for review" section (Phase 14 §5), modelled on
 * `loadMonthExpenses` in src/modules/expenses/queries.ts.
 */
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/src/db";
import { expenseDraftDocuments, expenseDrafts, fundingSources, lineItems } from "@/src/db/schema";
import { reimbursableCents } from "@/src/domain/money";
import { isUuid } from "@/src/lib/ids";
import type { AttachedDocument } from "@/src/modules/expenses/queries";

export type DraftRow = {
  id: string;
  importId: string;
  name: string;
  date: string;
  month: string;
  description: string;
  /** Null is the "Needs a line item" state (D-115) — never inner-joined away. */
  lineItemId: string | null;
  /** Always null: a draft's line item, when set, is only ever an id — nothing here resolves
   *  its name, unlike a real expense's `lineItemName` (there is no picker to show it in). */
  lineItemName: null;
  fundingSourceId: string;
  paymentSource: string;
  subtotalCents: number;
  taxCents: number;
  feesCents: number;
  note: string | null;
  narrative: string | null;
  sortOrder: number;
  reimbursableCents: number;
};

/**
 * Every draft waiting for review in a month, in the order the invoice listed them.
 * `fundingSourceId` null lists every source's drafts (All selected), matching
 * `loadMonthExpenses`'s own scope rule.
 */
export async function loadMonthDrafts(
  orgId: string,
  fundingSourceId: string | null,
  month: string,
): Promise<DraftRow[]> {
  const rows = await db
    .select({
      id: expenseDrafts.id,
      importId: expenseDrafts.importId,
      name: expenseDrafts.name,
      date: expenseDrafts.date,
      month: expenseDrafts.month,
      description: expenseDrafts.description,
      lineItemId: expenseDrafts.lineItemId,
      fundingSourceId: expenseDrafts.fundingSourceId,
      paymentSource: expenseDrafts.paymentSource,
      subtotalCents: expenseDrafts.subtotalCents,
      taxCents: expenseDrafts.taxCents,
      feesCents: expenseDrafts.feesCents,
      note: expenseDrafts.note,
      narrative: expenseDrafts.narrative,
      sortOrder: expenseDrafts.sortOrder,
      // The same reimbursement rule approval applies (`rulesForFundingSource`), read off the
      // draft's own source rather than assumed, so the figure shown here and the figure
      // approved can never disagree.
      taxReimbursable: fundingSources.taxReimbursable,
      feesReimbursable: fundingSources.feesReimbursable,
    })
    .from(expenseDrafts)
    // Left, not inner: `lineItemId` is nullable and null is exactly the state this section
    // exists to show — an inner join would silently hide those rows.
    .leftJoin(lineItems, eq(lineItems.id, expenseDrafts.lineItemId))
    .innerJoin(fundingSources, eq(fundingSources.id, expenseDrafts.fundingSourceId))
    .where(
      and(
        eq(expenseDrafts.orgId, orgId),
        fundingSourceId ? eq(expenseDrafts.fundingSourceId, fundingSourceId) : undefined,
        eq(expenseDrafts.month, month),
      ),
    )
    .orderBy(asc(expenseDrafts.sortOrder));

  return rows.map((row) => ({
    id: row.id,
    importId: row.importId,
    name: row.name,
    date: row.date,
    month: row.month,
    description: row.description,
    lineItemId: row.lineItemId,
    lineItemName: null,
    fundingSourceId: row.fundingSourceId,
    paymentSource: row.paymentSource,
    subtotalCents: row.subtotalCents,
    taxCents: row.taxCents,
    feesCents: row.feesCents,
    note: row.note,
    narrative: row.narrative,
    sortOrder: row.sortOrder,
    reimbursableCents: reimbursableCents({
      subtotalCents: row.subtotalCents,
      taxCents: row.taxCents,
      feesCents: row.feesCents,
      taxReimbursable: row.taxReimbursable,
      feesReimbursable: row.feesReimbursable,
    }),
  }));
}

/**
 * The files already attached to one draft, in the shape the expense form renders for a real
 * expense's own documents. Org-scoped through the draft, never by the document's `org_id`
 * alone, so a row whose two parents disagree can never be served for the wrong draft.
 */
export async function loadDraftDocuments(
  orgId: string,
  draftId: string,
): Promise<AttachedDocument[]> {
  if (!isUuid(draftId)) return [];

  return db
    .select({
      id: expenseDraftDocuments.id,
      kind: expenseDraftDocuments.kind,
      supportingType: expenseDraftDocuments.supportingType,
      filename: expenseDraftDocuments.filename,
      mimeType: expenseDraftDocuments.mimeType,
      pageCount: expenseDraftDocuments.pageCount,
      status: expenseDraftDocuments.status,
    })
    .from(expenseDraftDocuments)
    .innerJoin(expenseDrafts, eq(expenseDrafts.id, expenseDraftDocuments.draftId))
    .where(and(eq(expenseDraftDocuments.draftId, draftId), eq(expenseDrafts.orgId, orgId)))
    .orderBy(asc(expenseDraftDocuments.kind), asc(expenseDraftDocuments.sortOrder));
}

/** One draft's own columns, org-scoped, for the edit page. `undefined` when it's gone. */
export async function loadDraftById(orgId: string, id: string) {
  // Same guard, for the same reason, as `loadExpense`: the id comes off a route parameter,
  // and comparing a non-UUID against a uuid column raises a Postgres 22P02 that reaches the
  // page as a 500 rather than the "not found" that is both the truth and all a probe should
  // learn.
  if (!isUuid(id)) return undefined;

  const [row] = await db
    .select()
    .from(expenseDrafts)
    .where(and(eq(expenseDrafts.id, id), eq(expenseDrafts.orgId, orgId)))
    .limit(1);
  return row;
}
