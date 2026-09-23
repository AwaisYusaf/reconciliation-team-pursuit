"use server";

/**
 * Draft review actions (Phase 14 §5): approve, approve all ready, discard, undo, edit.
 *
 * Auth throughout is `actionSession()` — the same bar `createExpenseAction` uses (admins and
 * managers; there is no third role). Every id is guarded with `isUuid` and every read is
 * org-scoped: nothing here trusts an id, a funding source or a line item the client sent
 * without re-checking it against this session's own organisation.
 */
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import {
  expenseDocuments,
  expenseDraftDocuments,
  expenseDrafts,
  expenseImports,
  fundingSources,
  lineItems,
} from "@/src/db/schema";
import { isValidIsoDate, isValidMonthKey, monthLabel } from "@/src/domain/dates";
import { draftIsReady } from "@/src/domain/draft-rules";
import { parseMoneyToCentsOrZero } from "@/src/domain/money";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { isUuid } from "@/src/lib/ids";
import { type ExpenseInput } from "@/src/modules/expenses/actions";
import { insertExpenseWithAudit, learnVendor, type ExpenseRow } from "@/src/modules/expenses/expense-row";
import { validate } from "@/src/modules/expenses/validation";
import { requireOwnedFundingSource } from "@/src/modules/funding-sources/queries";
import { monthLocked } from "@/src/modules/packet/month-guard";
import { isKnownPaymentSource } from "@/src/modules/settings/labels";
import { attachImportAsReceipt, deleteStoredObjects } from "@/src/services/storage/documents";

import { loadMonthDrafts } from "./queries";

/** The same wording `removeExpenseDocumentAction` answers with, so removing a file reads the
 *  same whether it hung off a draft or an expense. */
const FILE_GONE_ERROR = "That file is already gone.";

const ARCHIVED_SOURCE_ERROR =
  "That funding source is archived. Unarchive it in Settings to add expenses to it.";

type ApprovalFailure =
  | { reason: "gone" }
  | { reason: "locked"; month: string }
  | { reason: "archived" }
  | { reason: "not-ready" };

/**
 * One draft becomes one real expense. Everything but the receipt attach and the vendor-library
 * write happens inside a single transaction, in this order (Phase 14 §5, PHASE-14.md §4):
 *
 * 1. `monthLocked`, before any write (R10.7, D-96), using the draft's own source/month.
 * 2. Lock the draft row itself (`FOR UPDATE`) — this is what makes two concurrent approvals of
 *    the same draft produce one expense, not two, rather than a bare re-check racing itself.
 * 3. The funding source, re-checked live, refused the same way a hand-added expense would be.
 * 4. Readiness, re-checked server side with `draftIsReady` — never trusted from whichever
 *    client asked for this approval — plus the line item's ownership, defence in depth.
 * 5. The ordinary `expenses` insert and its `created` audit event, so an approved expense is
 *    indistinguishable from one typed by hand.
 * 6. The draft row is deleted here, inside this same transaction — not after commit. Deleting
 *    it after commit would leave a window in which a second concurrent approval, blocked on
 *    the row lock above only until this transaction commits, reads the draft still live once
 *    that lock releases and creates a second expense for the same line. Deleting it under the
 *    same lock closes that window.
 */
export async function approveDraftAction(id: string): Promise<ActionResult<{ id: string }>> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail(UI.draftGone);

  const result = await db.transaction(async (tx) => {
    const [found] = await tx
      .select({ fundingSourceId: expenseDrafts.fundingSourceId, month: expenseDrafts.month })
      .from(expenseDrafts)
      .where(and(eq(expenseDrafts.id, id), eq(expenseDrafts.orgId, current.orgId)))
      .limit(1);
    if (!found) return { ok: false as const, failure: { reason: "gone" as const } };

    const locked = await monthLocked(tx, current.orgId, [
      { fundingSourceId: found.fundingSourceId, month: found.month },
    ]);
    if (locked) {
      return { ok: false as const, failure: { reason: "locked" as const, month: locked.month } };
    }

    const [draft] = await tx
      .select()
      .from(expenseDrafts)
      .where(and(eq(expenseDrafts.id, id), eq(expenseDrafts.orgId, current.orgId)))
      .for("update");
    if (!draft) return { ok: false as const, failure: { reason: "gone" as const } };

    const [source] = await tx
      .select({
        name: fundingSources.name,
        archivedAt: fundingSources.archivedAt,
        taxReimbursable: fundingSources.taxReimbursable,
        feesReimbursable: fundingSources.feesReimbursable,
      })
      .from(fundingSources)
      .where(and(eq(fundingSources.id, draft.fundingSourceId), eq(fundingSources.orgId, current.orgId)))
      .limit(1);
    if (!source) return { ok: false as const, failure: { reason: "gone" as const } };
    if (source.archivedAt) return { ok: false as const, failure: { reason: "archived" as const } };

    if (!draftIsReady(draft)) return { ok: false as const, failure: { reason: "not-ready" as const } };

    // Re-checked anyway, the same way createExpenseAction does: `draftIsReady` already catches
    // a line item deleted before approval (the FK sets `lineItemId` null on delete), but this
    // closes the same defence-in-depth gap that check closes there.
    const [item] = await tx
      .select({ name: lineItems.name })
      .from(lineItems)
      .where(
        and(
          eq(lineItems.id, draft.lineItemId!),
          eq(lineItems.orgId, current.orgId),
          eq(lineItems.fundingSourceId, draft.fundingSourceId),
        ),
      )
      .limit(1);
    if (!item) return { ok: false as const, failure: { reason: "not-ready" as const } };

    // An `ExpenseRow`, the same shape `createExpenseAction` builds through `toRow` — so the
    // insert and the audit snapshot below are fed by one object rather than two hand-written
    // field lists that have to agree.
    const row: ExpenseRow = {
      name: draft.name,
      fundingSourceId: draft.fundingSourceId,
      lineItemId: draft.lineItemId!,
      paymentSource: draft.paymentSource,
      month: draft.month,
      date: draft.date,
      description: draft.description,
      subtotalCents: draft.subtotalCents,
      taxCents: draft.taxCents,
      feesCents: draft.feesCents,
      // No default on these columns on purpose (schema.ts) — resolved fresh from the funding
      // source, exactly as `createExpenseAction` would for a hand-typed expense today.
      //
      // Read off the row already fetched above rather than through `rulesForFundingSource`,
      // which is the named supplier elsewhere: that helper takes the pooled handle and no
      // `tx`, and a second pool checkout from inside this transaction deadlocks under
      // concurrency (invariants §C). Reading it here also means the flags are read under the
      // same row lock as the archived check, which the helper could not give.
      taxReimbursable: source.taxReimbursable,
      feesReimbursable: source.feesReimbursable,
      note: draft.note,
      narrative: draft.narrative,
      noReceipt: false,
      noReceiptReason: null,
    };

    // The same supplier `createExpenseAction` and the from-invoice route use, so an approved
    // expense is written exactly as a hand-typed one is (D-115) rather than by a third copy of
    // the same block. `fromInvoice` is the provenance the ticket asks history to show (§7).
    const inserted = await insertExpenseWithAudit(tx, {
      orgId: current.orgId,
      actorUserId: current.userId,
      row,
      lineItemName: item.name,
      fundingSourceName: source.name,
      fromInvoice: true,
    });

    // Files added while this was a draft become the expense's own, carrying the SAME s3 key:
    // the object was stored once and is re-pointed, never uploaded again. Done inside this
    // transaction so an approval can never half move them, and before the draft row is
    // deleted, which would cascade them away.
    //
    // `FOR UPDATE` on these rows, not only on the draft: `removeDraftDocumentAction` deletes
    // one of them by its own id and then deletes the stored object, and it never touches the
    // draft row, so the draft's own lock does not hold it off. Without this lock a remove
    // landing between this read and the commit would delete bytes that the `expense_documents`
    // row written just below already points at, leaving an `attached` document with nothing
    // behind it — the exact state the documentation gate (R4.6) trusts and the packet build is
    // left to discover. Locked here, that remove waits, then finds its row cascaded away and
    // answers "already gone" without touching storage.
    const draftDocs = await tx
      .select()
      .from(expenseDraftDocuments)
      .where(eq(expenseDraftDocuments.draftId, id))
      .for("update");
    if (draftDocs.length > 0) {
      await tx.insert(expenseDocuments).values(
        draftDocs.map((doc) => ({
          orgId: current.orgId,
          expenseId: inserted.id,
          kind: doc.kind,
          supportingType: doc.supportingType,
          status: doc.status,
          s3Key: doc.s3Key,
          filename: doc.filename,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          thumbnailBytes: doc.thumbnailBytes,
          pageCount: doc.pageCount,
          widthPx: doc.widthPx,
          heightPx: doc.heightPx,
          sortOrder: doc.sortOrder,
        })),
      );
    }

    await tx.delete(expenseDrafts).where(eq(expenseDrafts.id, id));

    return {
      ok: true as const,
      expenseId: inserted.id,
      importId: draft.importId,
      row,
    };
  });

  if (!result.ok) return fail(approvalFailureMessage(result.failure));

  // After commit, its own transaction (`ingestExpenseDocument` opens one) — cannot be inside
  // the one above. Deliberately never rolls the approval back: the expense is real either way,
  // and a failed attach (the org's 5 GB quota full at approval, say) just leaves it without a
  // receipt, which the normal missing-documents column already shows.
  const [imported] = await db
    .select({
      s3Key: expenseImports.s3Key,
      filename: expenseImports.filename,
      mimeType: expenseImports.mimeType,
      sizeBytes: expenseImports.sizeBytes,
      thumbnailBytes: expenseImports.thumbnailBytes,
      pageCount: expenseImports.pageCount,
    })
    .from(expenseImports)
    .where(and(eq(expenseImports.id, result.importId), eq(expenseImports.orgId, current.orgId)))
    .limit(1);
  if (imported) {
    try {
      // Re-pointed, never re-uploaded: this used to download the whole invoice and store a
      // second copy of it per approval, so "Approve all ready" on a 25-line bill did 25
      // downloads and 25 uploads in one request and charged the org for 26 copies of one file.
      await attachImportAsReceipt(db, {
        orgId: current.orgId,
        expenseId: result.expenseId,
        imported,
      });
    } catch {
      // A failed attach must not undo the approval that already committed: the expense is real
      // either way, and the missing-documents column already shows it has no receipt.
    }
  }

  await learnVendor(current.orgId, result.row);

  revalidatePath("/", "layout");
  return ok({ id: result.expenseId });
}

function approvalFailureMessage(failure: ApprovalFailure): string {
  switch (failure.reason) {
    case "locked":
      return UI.monthLocked(monthLabel(failure.month));
    case "archived":
      return ARCHIVED_SOURCE_ERROR;
    case "not-ready":
      return UI.draftNotReady;
    default:
      return UI.draftGone;
  }
}

/**
 * Approve every ready draft in a month/scope, re-read here rather than trusted from the
 * client. Refuses the whole batch, before touching any draft, if a source a ready draft would
 * land under is locked or archived — rather than approving some and leaving the rest for a
 * reason the person never asked about.
 */
export async function approveReadyDraftsAction({
  month,
  fundingSourceId,
}: {
  month: string;
  /** `null` is "All funding sources", which approves across every grant in the month. */
  fundingSourceId: string | null;
}): Promise<ActionResult<{ message: string }>> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isValidMonthKey(month)) return fail(UI.draftGone);
  if (fundingSourceId !== null && !isUuid(fundingSourceId)) return fail(UI.draftGone);

  const rows = await loadMonthDrafts(current.orgId, fundingSourceId, month);
  const ready = rows.filter(draftIsReady);

  if (ready.length === 0) return ok({ message: UI.draftsApproved(0, rows.length) });

  const sourceIds = [...new Set(ready.map((row) => row.fundingSourceId))];
  const sources = await db
    .select({ id: fundingSources.id, archivedAt: fundingSources.archivedAt })
    .from(fundingSources)
    .where(and(eq(fundingSources.orgId, current.orgId), inArray(fundingSources.id, sourceIds)));
  if (sources.some((source) => source.archivedAt !== null)) return fail(ARCHIVED_SOURCE_ERROR);

  const locked = await monthLocked(
    db,
    current.orgId,
    sourceIds.map((id) => ({ fundingSourceId: id, month })),
  );
  if (locked) return fail(UI.monthLocked(monthLabel(locked.month)));

  let approved = 0;
  for (const draft of ready) {
    // Sequentially, not `Promise.all` — the pool is 10 connections and the reference claim
    // serialises per month anyway, so nothing is gained by racing these against each other.
    const result = await approveDraftAction(draft.id);
    if (result.ok) approved++;
  }

  return ok({ message: UI.draftsApproved(approved, rows.length - approved) });
}

/**
 * Remove one file attached to a draft — the draft-table twin of
 * `removeExpenseDocumentAction`, which only ever reaches `expense_documents`.
 *
 * Not gated on `monthLocked`, same reasoning as `discardDraftAction`: a draft is in no month
 * total and in no packet, so nothing a lock protects can change here. The stored object is
 * deleted only after the row is gone, never before, so a refused delete cannot destroy a file.
 */
export async function removeDraftDocumentAction(documentId: string): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(documentId)) return fail(FILE_GONE_ERROR);

  // Scoped through the draft, not through the document's own `org_id`: the parent is what
  // ownership actually follows from, and the two are separate FKs today.
  const [owned] = await db
    .select({ id: expenseDraftDocuments.id })
    .from(expenseDraftDocuments)
    .innerJoin(expenseDrafts, eq(expenseDrafts.id, expenseDraftDocuments.draftId))
    .where(and(eq(expenseDraftDocuments.id, documentId), eq(expenseDrafts.orgId, current.orgId)))
    .limit(1);
  if (!owned) return fail(FILE_GONE_ERROR);

  const [row] = await db
    .delete(expenseDraftDocuments)
    .where(eq(expenseDraftDocuments.id, documentId))
    .returning({ key: expenseDraftDocuments.s3Key });
  if (!row) return fail(FILE_GONE_ERROR);

  // Deletes the thumbnail alongside it; see its own definition.
  await deleteStoredObjects(row.key);

  revalidatePath("/", "layout");
  return ok();
}

/** Enough of a discarded draft's row to restore it (Undo). */
export type DiscardedDraft = {
  id: string;
  importId: string;
  fundingSourceId: string;
  month: string;
  date: string;
  name: string;
  description: string;
  lineItemId: string | null;
  paymentSource: string;
  subtotalCents: number;
  taxCents: number;
  feesCents: number;
  note: string | null;
  narrative: string | null;
  sortOrder: number;
  /** How many attached files went with it. Undo restores the draft, not these, so the toast
   *  has to say so rather than promise a whole restore. */
  removedFileCount: number;
};

/**
 * Remove a draft. Drafts never go to Trash — there is nothing to restore from there, this
 * action's own return value is the undo.
 *
 * Deliberately not gated on `monthLocked`: a draft is in no month total (§6), so removing one
 * changes nothing a lock protects.
 *
 * ponytail: Undo restores the draft's own fields, not the files that were attached to it —
 * those rows cascade away here and their objects are deleted, because leaving them would
 * strand bytes in the bucket that nothing could ever reach or count. If Undo must become
 * whole, the upgrade is a soft delete on `expense_draft_documents` plus a sweep, not keeping
 * the objects around on the chance someone presses it.
 */
export async function discardDraftAction(id: string): Promise<ActionResult<DiscardedDraft>> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail(UI.draftGone);

  // Read BEFORE the delete: `expense_draft_documents` cascades away with the draft row
  // (migration 0033), so a lookup afterwards would find nothing and the stored objects would
  // be stranded in the bucket with no row left to find them by — the same reasoning, and the
  // same ordering, as `permanentlyDeleteExpenseAction`.
  const attached = await db
    .select({ key: expenseDraftDocuments.s3Key })
    .from(expenseDraftDocuments)
    .innerJoin(expenseDrafts, eq(expenseDrafts.id, expenseDraftDocuments.draftId))
    .where(and(eq(expenseDraftDocuments.draftId, id), eq(expenseDrafts.orgId, current.orgId)));

  const [row] = await db
    .delete(expenseDrafts)
    .where(and(eq(expenseDrafts.id, id), eq(expenseDrafts.orgId, current.orgId)))
    .returning({
      id: expenseDrafts.id,
      importId: expenseDrafts.importId,
      fundingSourceId: expenseDrafts.fundingSourceId,
      month: expenseDrafts.month,
      date: expenseDrafts.date,
      name: expenseDrafts.name,
      description: expenseDrafts.description,
      lineItemId: expenseDrafts.lineItemId,
      paymentSource: expenseDrafts.paymentSource,
      subtotalCents: expenseDrafts.subtotalCents,
      taxCents: expenseDrafts.taxCents,
      feesCents: expenseDrafts.feesCents,
      note: expenseDrafts.note,
      narrative: expenseDrafts.narrative,
      sortOrder: expenseDrafts.sortOrder,
    });
  if (!row) return fail(UI.draftGone);

  // The rows are already gone (cascaded above); only the stored objects are left, removed
  // best-effort after the delete committed, exactly as the expense delete path does.
  // `deleteStoredObjects` skips anything another row still points at.
  for (const doc of attached) {
    await deleteStoredObjects(doc.key);
  }

  revalidatePath("/", "layout");
  return ok({ ...row, removedFileCount: attached.length });
}


/**
 * Undo a discard: re-insert the same draft, reusing its id.
 *
 * The values came back from the client (the toast's own state), which makes this a trust
 * boundary exactly like a fresh create — everything is re-validated against this session's
 * organisation rather than assumed to still be true.
 */
export async function undoDiscardAction(draft: DiscardedDraft): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  if (!isUuid(draft.id) || !isUuid(draft.importId) || !isUuid(draft.fundingSourceId)) {
    return fail(UI.draftGone);
  }
  if (draft.lineItemId !== null && !isUuid(draft.lineItemId)) return fail(UI.draftGone);
  if (!isValidMonthKey(draft.month)) return fail(UI.draftGone);
  if (!isValidIsoDate(draft.date)) return fail(UI.draftGone);
  if (
    !Number.isSafeInteger(draft.subtotalCents) ||
    !Number.isSafeInteger(draft.taxCents) ||
    !Number.isSafeInteger(draft.feesCents)
  ) {
    return fail(UI.draftGone);
  }
  // The rest of the payload, which was trusted because only the money looked dangerous. It is
  // all equally client-supplied: `sortOrder` decides where the row sits in the review list,
  // and `name`/`description` print on the expense this becomes. A non-integer sortOrder or a
  // non-string name reaches its column as a Postgres error thrown past the `ActionResult`
  // contract, which is the same class of bug the line-item guard above closes.
  if (!Number.isSafeInteger(draft.sortOrder) || draft.sortOrder < 0) return fail(UI.draftGone);
  if (typeof draft.name !== "string" || !draft.name.trim()) return fail(UI.draftGone);
  if (typeof draft.description !== "string") return fail(UI.draftGone);
  if (typeof draft.paymentSource !== "string") return fail(UI.draftGone);
  if (draft.note !== null && typeof draft.note !== "string") return fail(UI.draftGone);
  if (draft.narrative !== null && typeof draft.narrative !== "string") return fail(UI.draftGone);

  const [importRow] = await db
    .select({ id: expenseImports.id })
    .from(expenseImports)
    .where(and(eq(expenseImports.id, draft.importId), eq(expenseImports.orgId, current.orgId)))
    .limit(1);
  if (!importRow) return fail(UI.draftGone);

  const source = await requireOwnedFundingSource(current, draft.fundingSourceId);
  if ("denied" in source) return source.denied;
  if (source.archivedAt) return fail(ARCHIVED_SOURCE_ERROR);

  if (draft.lineItemId) {
    const owned = await db
      .select({ id: lineItems.id })
      .from(lineItems)
      .where(
        and(
          eq(lineItems.id, draft.lineItemId),
          eq(lineItems.orgId, current.orgId),
          eq(lineItems.fundingSourceId, draft.fundingSourceId),
        ),
      )
      .limit(1);
    if (owned.length === 0) return fail("Choose a line item.");
  }

  if (!(await isKnownPaymentSource(current.orgId, draft.paymentSource))) {
    return fail("Choose a payment source.");
  }

  await db
    .insert(expenseDrafts)
    .values({
      id: draft.id,
      importId: draft.importId,
      orgId: current.orgId,
      // Restoring is a save: the person who pressed Undo is who this draft came back from.
      createdByUserId: current.userId,
      updatedByUserId: current.userId,
      fundingSourceId: draft.fundingSourceId,
      month: draft.month,
      date: draft.date,
      name: draft.name,
      description: draft.description,
      lineItemId: draft.lineItemId,
      paymentSource: draft.paymentSource,
      subtotalCents: draft.subtotalCents,
      taxCents: draft.taxCents,
      feesCents: draft.feesCents,
      note: draft.note,
      narrative: draft.narrative,
      sortOrder: draft.sortOrder,
    })
    .onConflictDoNothing();

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Save an edited draft. Validated with `{ draft: true }` (a blank line item or narrative stays
 * allowed), and never moves funding source: the fields this writes do not include it, and the
 * source is re-verified owned here purely as defence in depth against a row that somehow
 * pointed at one it should not.
 *
 * Not gated on `monthLocked`, same reasoning as `discardDraftAction`: a draft is in no month
 * total, so editing one changes nothing a lock protects.
 */
export async function updateDraftAction(input: ExpenseInput): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!input.id || !isUuid(input.id)) return fail(UI.draftGone);

  const invalid = validate(input, { draft: true });
  if (invalid) return fail(invalid);
  // `validate` shape-checks the funding source but not the line item, and a draft's may be
  // blank. Guarded here the same way `undoDiscardAction` and the from-invoice route guard it:
  // a malformed id must read as a refusal, not raise a Postgres 22P02 that escapes the
  // `ActionResult` contract and reaches the client as a thrown error.
  if (input.lineItemId && !isUuid(input.lineItemId)) return fail("Choose a line item.");

  const [existing] = await db
    .select({ fundingSourceId: expenseDrafts.fundingSourceId })
    .from(expenseDrafts)
    .where(and(eq(expenseDrafts.id, input.id), eq(expenseDrafts.orgId, current.orgId)))
    .limit(1);
  if (!existing) return fail(UI.draftGone);

  const source = await requireOwnedFundingSource(current, existing.fundingSourceId);
  if ("denied" in source) return source.denied;

  if (input.lineItemId) {
    const owned = await db
      .select({ id: lineItems.id })
      .from(lineItems)
      .where(
        and(
          eq(lineItems.id, input.lineItemId),
          eq(lineItems.orgId, current.orgId),
          eq(lineItems.fundingSourceId, existing.fundingSourceId),
        ),
      )
      .limit(1);
    if (owned.length === 0) return fail("Choose a line item.");
  }

  if (!(await isKnownPaymentSource(current.orgId, input.paymentSource))) {
    return fail("Choose a payment source.");
  }

  const updated = await db
    .update(expenseDrafts)
    .set({
      name: input.name.trim(),
      lineItemId: input.lineItemId || null,
      paymentSource: input.paymentSource,
      date: input.date,
      description: input.description.trim(),
      subtotalCents: parseMoneyToCentsOrZero(input.subtotal),
      taxCents: parseMoneyToCentsOrZero(input.tax),
      feesCents: parseMoneyToCentsOrZero(input.fees),
      note: input.note.trim() || null,
      narrative: input.narrative.trim() || null,
      updatedByUserId: current.userId,
    })
    .where(and(eq(expenseDrafts.id, input.id), eq(expenseDrafts.orgId, current.orgId)))
    .returning({ id: expenseDrafts.id });
  if (updated.length === 0) return fail(UI.draftGone);

  revalidatePath("/", "layout");
  return ok();
}
