import "server-only";

/**
 * Draft reads for the "Waiting for review" section (Phase 14 §5), modelled on
 * `loadMonthExpenses` in src/modules/expenses/queries.ts.
 */
import { alias } from "drizzle-orm/pg-core";
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/src/db";
import {
  expenseDraftDocuments,
  expenseDrafts,
  fundingSources,
  lineItems,
  users,
} from "@/src/db/schema";
import { reimbursableCents } from "@/src/domain/money";
import { userDisplay } from "@/src/domain/user-display";
import { isUuid } from "@/src/lib/ids";
import type { AttachedDocument } from "@/src/modules/expenses/queries";

/**
 * `users` under its own name, because both queries below join it for the same purpose and a
 * named alias is what the `set null` actor column reads as in the generated SQL.
 */
const updatedBy = alias(users, "draft_updated_by");

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
  /**
   * Who last saved this draft, and when.
   *
   * `lastSavedBy` is null for a draft written before the column existed, or whose author's
   * account has since been removed — the screen says nothing rather than guessing at a name.
   * `lastSavedAt` is the row's `updated_at`, which Postgres maintains on every write, so it
   * is the time of the last save whether or not an actor was recorded with it.
   */
  lastSavedBy: string | null;
  /**
   * The saver's own name, email and avatar key, unformatted.
   *
   * `lastSavedBy` above is already a display string, which is right for a sentence but useless
   * to an avatar: initials come from the name *or* the email local part, and those have to be
   * told apart. Null together with `lastSavedBy`, for the same reasons.
   */
  lastSavedByName: string | null;
  lastSavedByEmail: string | null;
  lastSavedByAvatarKey: string | null;
  lastSavedAt: Date;
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
      // Who last saved this draft, and when. Two people review the same import, so the
      // question before picking one up is whether someone else is already in it.
      updatedAt: expenseDrafts.updatedAt,
      updatedByName: updatedBy.name,
      updatedByEmail: updatedBy.email,
      // No extra query: `updatedBy` is already joined for the name and email.
      updatedByAvatarKey: updatedBy.avatarKey,
    })
    .from(expenseDrafts)
    // Left, and aliased: the column is nullable for a draft written before it existed, and
    // `set null` on the foreign key means a removed account leaves the draft behind with no
    // actor. An inner join would drop exactly the rows someone most needs to see.
    .leftJoin(updatedBy, eq(updatedBy.id, expenseDrafts.updatedByUserId))
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
    lastSavedBy: row.updatedByEmail ? userDisplay(row.updatedByName, row.updatedByEmail) : null,
    // Gated on the email too, so all four move together: with no actor row the join returns
    // nulls across the board and the screen shows no saver at all rather than a faceless one.
    lastSavedByName: row.updatedByEmail ? row.updatedByName : null,
    lastSavedByEmail: row.updatedByEmail,
    lastSavedByAvatarKey: row.updatedByEmail ? row.updatedByAvatarKey : null,
    lastSavedAt: row.updatedAt,
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
    .select({
      draft: expenseDrafts,
      updatedByName: updatedBy.name,
      updatedByEmail: updatedBy.email,
      // No extra query: `updatedBy` is already joined for the name and email.
      updatedByAvatarKey: updatedBy.avatarKey,
    })
    .from(expenseDrafts)
    // Left, for the same reason as in `loadMonthDrafts`: the actor is nullable and a removed
    // account nulls it, and neither is a reason to stop returning the draft.
    .leftJoin(updatedBy, eq(updatedBy.id, expenseDrafts.updatedByUserId))
    .where(and(eq(expenseDrafts.id, id), eq(expenseDrafts.orgId, orgId)))
    .limit(1);
  if (!row) return undefined;

  return {
    ...row.draft,
    lastSavedBy: row.updatedByEmail
      ? userDisplay(row.updatedByName, row.updatedByEmail)
      : null,
  };
}
