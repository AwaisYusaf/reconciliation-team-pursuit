"use server";

/**
 * Draft review actions (Phase 14 §5): approve, approve all ready, discard, undo, edit.
 *
 * Auth throughout is `actionSession()` — the same bar `createExpenseAction` uses (admins and
 * managers; there is no third role). Every id is guarded with `isUuid` and every read is
 * org-scoped: nothing here trusts an id, a funding source or a line item the client sent
 * without re-checking it against this session's own organisation.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import {
  expenseAuditEvents,
  expenseDrafts,
  expenseImports,
  expenses,
  fundingSources,
  lineItems,
  type ExpenseAuditSnapshot,
} from "@/src/db/schema";
import { isValidIsoDate, isValidMonthKey, monthLabel } from "@/src/domain/dates";
import { draftIsReady } from "@/src/domain/draft-rules";
import { parseMoneyToCentsOrZero } from "@/src/domain/money";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { isUuid } from "@/src/lib/ids";
import { learnVendor, type ExpenseInput } from "@/src/modules/expenses/actions";
import { claimReferenceSeq } from "@/src/modules/expenses/references";
import { validate } from "@/src/modules/expenses/validation";
import { requireOwnedFundingSource } from "@/src/modules/funding-sources/queries";
import { monthLocked } from "@/src/modules/packet/month-guard";
import { isKnownPaymentSource } from "@/src/modules/settings/labels";
import { ingestExpenseDocument } from "@/src/services/storage/documents";
import { storage } from "@/src/services/storage/driver";

import { loadMonthDrafts } from "./queries";

/** The same 15-field snapshot `snapshotOf` builds in expenses/actions.ts, duplicated here for
 *  the same import-boundary reason `invoice-match.ts` duplicates its own helpers: that
 *  function is private to a `"use server"` module and this one needs its own row shape anyway
 *  (a draft has no `noReceipt`/`noReceiptReason` of its own). Keep the two in sync. */
function snapshotFor(
  row: {
    name: string;
    lineItemId: string;
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
  },
  lineItemName: string,
  fundingSourceName: string,
): ExpenseAuditSnapshot {
  return {
    name: row.name,
    lineItemId: row.lineItemId,
    lineItemName,
    fundingSourceName,
    paymentSource: row.paymentSource,
    month: row.month,
    date: row.date,
    description: row.description,
    subtotalCents: row.subtotalCents,
    taxCents: row.taxCents,
    feesCents: row.feesCents,
    taxReimbursable: row.taxReimbursable,
    feesReimbursable: row.feesReimbursable,
    note: row.note,
    narrative: row.narrative,
    noReceipt: false,
    noReceiptReason: null,
  };
}

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

    const row = {
      name: draft.name,
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
      taxReimbursable: source.taxReimbursable,
      feesReimbursable: source.feesReimbursable,
      note: draft.note,
      narrative: draft.narrative,
    };

    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${expenses.sortOrder}), -1) + 1` })
      .from(expenses)
      .where(and(eq(expenses.orgId, current.orgId), eq(expenses.month, row.month)));

    const [inserted] = await tx
      .insert(expenses)
      .values({
        orgId: current.orgId,
        fundingSourceId: draft.fundingSourceId,
        ...row,
        noReceipt: false,
        noReceiptReason: null,
        sortOrder: Number(next),
        referenceSeq: await claimReferenceSeq(current.orgId, draft.fundingSourceId, row.month, tx),
      })
      .returning({ id: expenses.id });

    // PROVENANCE (ticket §7): the approver is already this event's actor, so half of "who
    // approved it" is free. `fromInvoice` records the other half — no migration, no schema
    // change (both off limits): the extra key rides in the jsonb column, and every existing
    // reader (`AuditDiffContent`'s fixed `FIELDS` list) ignores keys it doesn't name. Not
    // rendered yet — see this module's report for what a display row would still need.
    const snapshot: ExpenseAuditSnapshot & { fromInvoice: true } = {
      ...snapshotFor(row, item.name, source.name),
      fromInvoice: true,
    };

    await tx.insert(expenseAuditEvents).values({
      orgId: current.orgId,
      expenseId: inserted.id,
      actorUserId: current.userId,
      action: "created",
      beforeData: null,
      afterData: snapshot,
    });

    await tx.delete(expenseDrafts).where(eq(expenseDrafts.id, id));

    return {
      ok: true as const,
      expenseId: inserted.id,
      importId: draft.importId,
      row: { ...row, fundingSourceId: draft.fundingSourceId },
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
    })
    .from(expenseImports)
    .where(and(eq(expenseImports.id, result.importId), eq(expenseImports.orgId, current.orgId)))
    .limit(1);
  if (imported) {
    try {
      const bytes = await storage().get(imported.s3Key);
      // `new Uint8Array(bytes)`, not the Buffer itself: a Node Buffer is not a `BlobPart`, and
      // the view shares the same memory rather than copying the invoice a second time.
      const file = new File([new Uint8Array(bytes)], imported.filename, {
        type: imported.mimeType,
      });
      await ingestExpenseDocument({
        orgId: current.orgId,
        expenseId: result.expenseId,
        scope: "receipt",
        file,
      });
    } catch {
      // See the comment above: a missing or unreadable stored object must not undo the
      // approval that already committed.
    }
  }

  await learnVendor(current.orgId, {
    ...result.row,
    noReceipt: false,
    noReceiptReason: null,
  });

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
export async function approveReadyDraftsAction(
  month: string,
  fundingSourceId: string | null,
): Promise<ActionResult<{ message: string }>> {
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
};

/**
 * Remove a draft. Drafts never go to Trash — there is nothing to restore from there, this
 * action's own return value is the undo.
 *
 * Deliberately not gated on `monthLocked`: a draft is in no month total (§6), so removing one
 * changes nothing a lock protects, unlike deleting a real expense.
 */
export async function discardDraftAction(id: string): Promise<ActionResult<DiscardedDraft>> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail(UI.draftGone);

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

  revalidatePath("/", "layout");
  return ok(row);
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
    })
    .where(and(eq(expenseDrafts.id, input.id), eq(expenseDrafts.orgId, current.orgId)))
    .returning({ id: expenseDrafts.id });
  if (updated.length === 0) return fail(UI.draftGone);

  revalidatePath("/", "layout");
  return ok();
}
