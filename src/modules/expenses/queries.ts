import "server-only";

/**
 * Expense reads for m02 and m03.
 */
import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, sql, type AnyColumn } from "drizzle-orm";

import { db } from "@/src/db";
import { isUuid } from "@/src/lib/ids";
import {
  expenseAuditAction,
  expenseAuditEvents,
  expenseDocuments,
  expenseImports,
  expenses,
  fundingSources,
  lineItems,
  supportingDocTypes,
  users,
} from "@/src/db/schema";
import type { DocumentKind, ExpenseAuditActionType, ExpenseAuditSnapshot } from "@/src/db/schema";
import { formatMoney } from "@/src/domain/format";
import { expenseReference } from "@/src/domain/strings";
import { reimbursableCents } from "@/src/domain/money";
import { activePaymentSources } from "@/src/modules/settings/labels";

export type AttachedDocument = {
  id: string;
  kind: DocumentKind;
  supportingType: string | null;
  filename: string;
  mimeType: string;
  pageCount: number | null;
  status: "pending" | "attached" | "failed";
  /** The whole invoice this charge was imported from (its object is an `expense_imports` row's).
   *  Never read for amounts or a vendor: they are the bill's, not this one charge's. */
  fromInvoice: boolean;
};

/** True when a document row's stored object is one of the organisation's imported invoices:
 *  approval re-points the invoice itself as each charge's receipt rather than copying it.
 *  ponytail: one EXISTS per document row, found through the org_id prefix of
 *  `expense_imports_org_source_month_idx`; add an (org_id, s3_key) index if an org's imports
 *  ever run into the thousands. */
export function isImportedInvoice(document: { orgId: AnyColumn; s3Key: AnyColumn }) {
  return sql<boolean>`${exists(
    db
      .select({ one: sql`1` })
      .from(expenseImports)
      .where(and(eq(expenseImports.orgId, document.orgId), eq(expenseImports.s3Key, document.s3Key))),
  )}`;
}

export type ExpenseDetail = {
  id: string;
  name: string;
  lineItemId: string;
  lineItemName: string;
  fundingSourceId: string;
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

/** Options the expense form needs: the org's funding sources (each with its own line items) and
 *  its active label lists. `currentSourceId` is the expense's own source on edit (so an archived
 *  source it already sits on is still offered), `null` on the add form. */
export async function loadExpenseFormOptions(orgId: string, currentSourceId: string | null) {
  const [activeSources, currentSource, paySources, docTypes] = await Promise.all([
    db
      .select({
        id: fundingSources.id,
        name: fundingSources.name,
        taxReimbursable: fundingSources.taxReimbursable,
        feesReimbursable: fundingSources.feesReimbursable,
      })
      .from(fundingSources)
      .where(and(eq(fundingSources.orgId, orgId), isNull(fundingSources.archivedAt)))
      .orderBy(asc(fundingSources.sortOrder), asc(fundingSources.name), asc(fundingSources.id)),
    currentSourceId
      ? db
          .select({
            id: fundingSources.id,
            name: fundingSources.name,
            taxReimbursable: fundingSources.taxReimbursable,
            feesReimbursable: fundingSources.feesReimbursable,
          })
          .from(fundingSources)
          .where(and(eq(fundingSources.id, currentSourceId), eq(fundingSources.orgId, orgId)))
          .limit(1)
      : Promise.resolve([]),
    // One reader for the list and its order: the first is the "usual" source an invoice charge
    // falls back to, and the default a recurring add picks.
    activePaymentSources(orgId),
    db
      .select({ label: supportingDocTypes.label })
      .from(supportingDocTypes)
      .where(and(eq(supportingDocTypes.orgId, orgId), eq(supportingDocTypes.active, true)))
      .orderBy(asc(supportingDocTypes.sortOrder)),
  ]);

  // `currentSource` (archived or not) is added only if not already in the active list.
  const fundingSourcesList = activeSources.some((source) => source.id === currentSourceId)
    ? activeSources
    : [...activeSources, ...currentSource];

  const sourceIds = fundingSourcesList.map((source) => source.id);
  const items =
    sourceIds.length === 0
      ? []
      : await db
          .select({ id: lineItems.id, name: lineItems.name, fundingSourceId: lineItems.fundingSourceId })
          .from(lineItems)
          .where(and(eq(lineItems.orgId, orgId), inArray(lineItems.fundingSourceId, sourceIds)))
          .orderBy(asc(lineItems.sortOrder), asc(lineItems.name));

  const lineItemsBySource: Record<string, Array<{ id: string; name: string }>> = Object.fromEntries(
    sourceIds.map((id) => [id, []]),
  );
  for (const item of items) {
    lineItemsBySource[item.fundingSourceId]!.push({ id: item.id, name: item.name });
  }

  return {
    fundingSources: fundingSourcesList,
    lineItemsBySource,
    paymentSources: paySources,
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
      fromInvoice: isImportedInvoice(expenseDocuments),
    })
    .from(expenseDocuments)
    // Only these expenses' files, found by `expense_documents_expense_idx` (Phase 0 B7). It used to
    // load every document in the organisation on each list, detail and trash read, then throw
    // most of them away here.
    // ponytail: one bind parameter per id, and Postgres allows 65,535 per query. Only the trash
    // (every month) is unbounded, so ~65,000 trashed expenses would fail here; chunk the ids if
    // a trash ever gets near that.
    .where(and(eq(expenseDocuments.orgId, orgId), inArray(expenseDocuments.expenseId, expenseIds)))
    .orderBy(asc(expenseDocuments.kind), asc(expenseDocuments.sortOrder));

  const byExpense = new Map<string, AttachedDocument[]>();
  for (const row of rows) {
    const list = byExpense.get(row.expenseId) ?? [];
    list.push(row);
    byExpense.set(row.expenseId, list);
  }
  return byExpense;
}

/** Page size for the audit log (D-87). */
const AUDIT_PAGE_SIZE = 50;

/**
 * Ceiling on the page number, so `page` reaches SQL as an OFFSET Postgres can hold.
 *
 * `page` comes off a query string, where `?page=99999999999999999999` parses to a finite
 * 1e20 and multiplies into an OFFSET past `bigint`, which Postgres rejects — a crafted URL
 * would otherwise be an unhandled 500 rather than an empty page. 100k pages is 5M events,
 * far past anything this log reaches, and beyond it there is nothing to show anyway.
 */
const MAX_AUDIT_PAGE = 100_000;

/** One row of the org-wide audit log, admin-only. */
export type OrgAuditEvent = {
  id: string;
  action: ExpenseAuditActionType;
  actorEmail: string;
  /** Null for a legacy account that predates the `users.name` column (D-89); render through
   *  `userDisplay` at the UI, not here. */
  actorName: string | null;
  /** The actor's `users.avatar_key`, null until they upload a photo. Carried so the log can
   *  show a face beside the name; the UI turns it into a URL, never the key itself. */
  actorAvatarKey: string | null;
  at: Date;
  expenseId: string | null;
  /** `{month}-{seq}` when the expense (still or once) has a month/reference to print — null
   *  once it's gone for good (permanent delete), where there is nothing left to point at. */
  reference: string | null;
  /** Always available: every event's own snapshot carries the name, so there is never a bare
   *  "deleted" placeholder even once the expense itself is gone. */
  expenseName: string;
  beforeData: ExpenseAuditSnapshot | null;
  afterData: ExpenseAuditSnapshot | null;
};

/**
 * Org-wide audit log (D-87), global — not scoped to the header's selected month. Paginated at
 * 50/page; a page fetches 51 rows to know whether a next page exists rather than a separate
 * COUNT query, since nothing here needs a total, only prev/next.
 */
export async function loadOrgAuditHistory(
  orgId: string,
  {
    page = 1,
    actionType,
    expenseId,
  }: { page?: number; actionType?: ExpenseAuditActionType; expenseId?: string } = {},
): Promise<{ events: OrgAuditEvent[]; hasNextPage: boolean }> {
  // Validated server-side rather than trusted from the caller — this is the query a client
  // component's filter reaches through a server action / search param, not a hardcoded value.
  const validAction =
    actionType && expenseAuditAction.enumValues.includes(actionType) ? actionType : undefined;

  // A non-uuid must return empty, never reach the uuid column and raise a Postgres 22P02 as
  // an unhandled 500 — same reasoning as `loadExpense`'s guard.
  if (expenseId !== undefined && !isUuid(expenseId)) return { events: [], hasNextPage: false };

  // Clamped here rather than at the page: this is the shared entry point, so a caller that
  // forgets to sanitise its own search param still cannot reach SQL with a bad OFFSET.
  const safePage = Math.min(MAX_AUDIT_PAGE, Math.max(1, Math.trunc(page) || 1));
  const offset = (safePage - 1) * AUDIT_PAGE_SIZE;

  const rows = await db
    .select({
      id: expenseAuditEvents.id,
      action: expenseAuditEvents.action,
      actorEmail: users.email,
      actorName: users.name,
      // No extra query: `users` is already joined for the name and email.
      actorAvatarKey: users.avatarKey,
      at: expenseAuditEvents.createdAt,
      expenseId: expenseAuditEvents.expenseId,
      month: expenses.month,
      referenceSeq: expenses.referenceSeq,
      beforeData: expenseAuditEvents.beforeData,
      afterData: expenseAuditEvents.afterData,
    })
    .from(expenseAuditEvents)
    .innerJoin(users, eq(users.id, expenseAuditEvents.actorUserId))
    // Left, not inner: a permanently-deleted expense has expenseId set null (D-86) and must
    // still appear in the log with whatever the join can't supply falling back to the snapshot.
    .leftJoin(expenses, eq(expenses.id, expenseAuditEvents.expenseId))
    .where(
      and(
        eq(expenseAuditEvents.orgId, orgId),
        validAction ? eq(expenseAuditEvents.action, validAction) : undefined,
        expenseId !== undefined ? eq(expenseAuditEvents.expenseId, expenseId) : undefined,
      ),
    )
    // Id breaks a timestamp tie, the same reasoning as the per-expense history this replaces:
    // uuid v7 ids sort in write order.
    .orderBy(desc(expenseAuditEvents.createdAt), desc(expenseAuditEvents.id))
    .limit(AUDIT_PAGE_SIZE + 1)
    .offset(offset);

  const hasNextPage = rows.length > AUDIT_PAGE_SIZE;
  const page_ = rows.slice(0, AUDIT_PAGE_SIZE);

  const events: OrgAuditEvent[] = page_.map((row) => {
    // Typed at the column (schema.ts: `.$type<ExpenseAuditSnapshot>()`), so this is already
    // `ExpenseAuditSnapshot | null` with no cast needed.
    const after = row.afterData;
    const before = row.beforeData;
    return {
      id: row.id,
      action: row.action,
      actorEmail: row.actorEmail,
      actorName: row.actorName,
      actorAvatarKey: row.actorAvatarKey,
      at: row.at,
      expenseId: row.expenseId,
      reference: row.month && row.referenceSeq ? expenseReference(row.month, row.referenceSeq) : null,
      expenseName: after?.name ?? before?.name ?? "",
      beforeData: before,
      afterData: after,
    };
  });

  return { events, hasNextPage };
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
      fundingSourceId: expenses.fundingSourceId,
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

/** Every expense in a month, in entry order, with documents attached (m03).
 *  `fundingSourceId` null lists every source's expenses (All selected). */
export async function loadMonthExpenses(
  orgId: string,
  fundingSourceId: string | null,
  month: string,
): Promise<ExpenseDetail[]> {
  const rows = await db
    .select({
      id: expenses.id,
      name: expenses.name,
      lineItemId: expenses.lineItemId,
      lineItemName: lineItems.name,
      fundingSourceId: expenses.fundingSourceId,
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
    .where(
      and(
        eq(expenses.orgId, orgId),
        fundingSourceId ? eq(expenses.fundingSourceId, fundingSourceId) : undefined,
        eq(expenses.month, month),
        isNull(expenses.deletedAt),
      ),
    )
    .orderBy(asc(expenses.sortOrder));

  const documents = await documentsFor(
    orgId,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    ...row,
    documents: documents.get(row.id) ?? [],
  }));
}

/** One trashed expense, as much of it as the Trash screen shows. */
export type TrashedExpense = {
  id: string;
  name: string;
  month: string;
  lineItemName: string;
  fundingSourceId: string;
  amountCents: number;
  deletedAt: Date;
  // Soft delete leaves documents attached (they only go away on permanent delete), so the
  // trash can show what would be restored or lost, the same as the active list does.
  documents: AttachedDocument[];
};

/**
 * Everything currently in the trash, newest deletion first.
 *
 * All months, no scoping, unless `month` is given — the packet screen uses that to show only
 * what was deleted from the reporting period it is about to download, without a second
 * near-identical query.
 */
export async function loadTrashedExpenses(
  orgId: string,
  fundingSourceId: string | null,
  month?: string,
): Promise<TrashedExpense[]> {
  const rows = await db
    .select({
      id: expenses.id,
      name: expenses.name,
      month: expenses.month,
      lineItemName: lineItems.name,
      fundingSourceId: expenses.fundingSourceId,
      subtotalCents: expenses.subtotalCents,
      taxCents: expenses.taxCents,
      feesCents: expenses.feesCents,
      taxReimbursable: expenses.taxReimbursable,
      feesReimbursable: expenses.feesReimbursable,
      deletedAt: expenses.deletedAt,
    })
    .from(expenses)
    .innerJoin(lineItems, eq(lineItems.id, expenses.lineItemId))
    .where(
      and(
        eq(expenses.orgId, orgId),
        fundingSourceId ? eq(expenses.fundingSourceId, fundingSourceId) : undefined,
        isNotNull(expenses.deletedAt),
        month ? eq(expenses.month, month) : undefined,
      ),
    )
    .orderBy(desc(expenses.deletedAt));

  const documents = await documentsFor(orgId, rows.map((row) => row.id));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    month: row.month,
    lineItemName: row.lineItemName,
    fundingSourceId: row.fundingSourceId,
    amountCents: reimbursableCents(row),
    // Narrowed by the WHERE above: every row here has a `deletedAt` already.
    deletedAt: row.deletedAt!,
    documents: documents.get(row.id) ?? [],
  }));
}

/**
 * The plain-text refusal a download route sends when a month has deletions the user has not
 * confirmed — the safeguard the packet screen's dialog exists for. A promise enforced only in
 * the browser is not enforced (the same principle `downloads/summary/route.ts` already states
 * for the documentation gate), so both download routes call this rather than trusting the
 * client to have shown the dialog at all.
 */
export function deletedItemsRefusal(trashed: readonly TrashedExpense[]): string {
  const plural = trashed.length !== 1;
  return (
    `${trashed.length} expense${plural ? "s" : ""} ${plural ? "were" : "was"} deleted from ` +
    `this month and ${plural ? "haven't" : "hasn't"} been confirmed:\n` +
    trashed
      .map((expense) => `• ${expense.name} · ${expense.lineItemName} · ${formatMoney(expense.amountCents)}`)
      .join("\n")
  );
}
