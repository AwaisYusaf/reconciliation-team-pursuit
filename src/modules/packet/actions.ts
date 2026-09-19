"use server";

/**
 * Month-end packet actions (m06): month documents and the submission marker.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import { monthDocuments, monthLockEvents, monthStatuses } from "@/src/db/schema";
import { isValidMonthKey, monthLabel } from "@/src/domain/dates";
import { UI, UNLOCK_REASON_MAX_LENGTH } from "@/src/domain/strings";
import { isUuid } from "@/src/lib/ids";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { requireOwnedFundingSource } from "@/src/modules/funding-sources/queries";
import { monthLocked } from "./month-guard";
import { captureMonthSnapshot, discardMonthSnapshot } from "./snapshot";
import { deleteStoredObjects } from "@/src/services/storage/documents";

/** Remove one month document (immediate; the row's Remove button warns first). */
export async function removeMonthDocumentAction(
  documentId: string,
  fundingSourceId: string,
): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(documentId)) return fail("That file is already gone.");

  const owned = await requireOwnedFundingSource(current, fundingSourceId);
  if ("denied" in owned) return owned.denied;
  // Archiving a source is meant to leave its history and documents intact and viewable — the
  // whole reason archived sources stay selectable at all. Uploading a month document to one is
  // already refused (`app/api/files/upload/route.ts`); deleting one out of it is the same
  // record, from the other end, so it is refused here too.
  if (owned.archivedAt) return fail("That funding source is archived. Unarchive it in Settings to remove documents.");

  // The document's own month is what the guard checks. Scoped by organisation and funding
  // source, so another org's or another source's id simply finds nothing.
  const [doc] = await db
    .select({ month: monthDocuments.month })
    .from(monthDocuments)
    .where(
      and(
        eq(monthDocuments.id, documentId),
        eq(monthDocuments.orgId, current.orgId),
        eq(monthDocuments.fundingSourceId, owned.id),
      ),
    )
    .limit(1);
  if (!doc) return fail("That file is already gone.");

  // Guard, then delete the row in one transaction; the stored objects are only removed after
  // that commits (plan §3.4).
  const removed = await db.transaction(async (tx) => {
    const locked = await monthLocked(tx, current.orgId, [
      { fundingSourceId: owned.id, month: doc.month },
    ]);
    if (locked) return { ok: false as const, locked };

    const rows = await tx
      .delete(monthDocuments)
      .where(
        and(
          eq(monthDocuments.id, documentId),
          eq(monthDocuments.orgId, current.orgId),
          eq(monthDocuments.fundingSourceId, owned.id),
        ),
      )
      .returning({ key: monthDocuments.s3Key });
    return { ok: true as const, rows };
  });
  if (!removed.ok) return fail(UI.monthLocked(monthLabel(removed.locked.month)));
  if (removed.rows.length === 0) return fail("That file is already gone.");

  await deleteStoredObjects(removed.rows[0].key);

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Mark a month as submitted (R10.6, D-21).
 *
 * Records only that a submission happened; it never alters the artifacts, which are already
 * pinned. Editing a submitted month stays possible — the flag is what makes the warning
 * elsewhere truthful rather than a lock.
 */
export async function markMonthSubmittedAction(
  month: string,
  fundingSourceId: string,
): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isValidMonthKey(month)) return fail("That is not a valid month.");

  const owned = await requireOwnedFundingSource(current, fundingSourceId);
  if ("denied" in owned) return owned.denied;

  // Guard, then upsert, in one transaction — a lock landing between the two must not have this
  // overwrite `submitted_at` and re-capture the snapshot of a month that is now Reconciled.
  const now = new Date();
  const locked = await db.transaction(async (tx) => {
    const locked = await monthLocked(tx, current.orgId, [{ fundingSourceId: owned.id, month }]);
    if (locked) return locked;

    await tx
      .insert(monthStatuses)
      .values({ orgId: current.orgId, fundingSourceId: owned.id, month, submittedAt: now })
      .onConflictDoUpdate({
        target: [monthStatuses.orgId, monthStatuses.fundingSourceId, monthStatuses.month],
        set: { submittedAt: now },
      });
    return null;
  });
  if (locked) return fail(UI.monthLocked(monthLabel(locked.month)));

  // Submission is what makes a month's figures official, so it is where they are recorded
  // (D-68). Everything else in the app recomputes from live rows, which means a later
  // correction would otherwise rewrite what this month is said to have closed at.
  await captureMonthSnapshot(current.orgId, owned.id, month);

  revalidatePath("/", "layout");
  return ok();
}

/** Undo the marker, for a month marked by mistake. Refused on a locked month (R10.7). */
export async function clearMonthSubmittedAction(
  month: string,
  fundingSourceId: string,
): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isValidMonthKey(month)) return fail("That is not a valid month.");

  const owned = await requireOwnedFundingSource(current, fundingSourceId);
  if ("denied" in owned) return owned.denied;

  const updated = await db
    .update(monthStatuses)
    .set({ submittedAt: null })
    .where(
      and(
        eq(monthStatuses.orgId, current.orgId),
        eq(monthStatuses.fundingSourceId, owned.id),
        eq(monthStatuses.month, month),
        isNull(monthStatuses.lockedAt),
      ),
    )
    .returning({ orgId: monthStatuses.orgId });

  if (updated.length === 0) {
    // Nothing matched: either the month is locked (`locked_at IS NULL` excluded its row), or
    // there is no row at all yet, which was already a silent no-op before this change — only
    // the first case is a real refusal.
    const [row] = await db
      .select({ lockedAt: monthStatuses.lockedAt })
      .from(monthStatuses)
      .where(
        and(
          eq(monthStatuses.orgId, current.orgId),
          eq(monthStatuses.fundingSourceId, owned.id),
          eq(monthStatuses.month, month),
        ),
      )
      .limit(1);
    if (row?.lockedAt) return fail(UI.monthLocked(monthLabel(month)));
  }

  // No longer claimed as sent, so figures labelled "as submitted" would assert something
  // untrue. The pinned artifact keeps the bytes that were actually delivered (R10.6).
  await discardMonthSnapshot(current.orgId, owned.id, month);

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Unlock a month (R10.7): clears `locked_at` and records the unlock event with its optional
 * reason. `submitted_at` is left alone — that is what puts the month back to Submitted, not
 * Open (plan §3.1). The signed copy is never deleted.
 */
export async function unlockMonthAction(
  month: string,
  fundingSourceId: string,
  reason: string,
): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isValidMonthKey(month)) return fail("That is not a valid month.");

  const owned = await requireOwnedFundingSource(current, fundingSourceId);
  if ("denied" in owned) return owned.denied;

  const trimmed = reason.trim();
  if (trimmed.length > UNLOCK_REASON_MAX_LENGTH) {
    return fail(UI.unlockReasonTooLong(UNLOCK_REASON_MAX_LENGTH));
  }

  const unlocked = await db.transaction(async (tx) => {
    const updated = await tx
      .update(monthStatuses)
      .set({ lockedAt: null })
      .where(
        and(
          eq(monthStatuses.orgId, current.orgId),
          eq(monthStatuses.fundingSourceId, owned.id),
          eq(monthStatuses.month, month),
          isNotNull(monthStatuses.lockedAt),
        ),
      )
      .returning({ orgId: monthStatuses.orgId });
    if (updated.length === 0) return false;

    await tx.insert(monthLockEvents).values({
      orgId: current.orgId,
      fundingSourceId: owned.id,
      month,
      actorUserId: current.userId,
      reason: trimmed || null,
    });
    return true;
  });

  if (!unlocked) return fail(UI.monthNotLocked);

  revalidatePath("/", "layout");
  return ok();
}
