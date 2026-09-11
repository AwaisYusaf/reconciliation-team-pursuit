"use server";

/**
 * Month-end packet actions (m06): month documents and the submission marker.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import { monthStatuses } from "@/src/db/schema";
import { isValidMonthKey } from "@/src/domain/dates";
import { isUuid } from "@/src/lib/ids";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { requireOwnedFundingSource } from "@/src/modules/funding-sources/queries";
import { captureMonthSnapshot, discardMonthSnapshot } from "./snapshot";
import { deleteMonthDocument } from "@/src/services/storage/documents";

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

  // Scoped by organisation and funding source inside the service, so another org's or another
  // source's id simply finds nothing.
  const removed = await deleteMonthDocument(current.orgId, owned.id, documentId);
  if (!removed) return fail("That file is already gone.");

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

  const now = new Date();
  await db
    .insert(monthStatuses)
    .values({ orgId: current.orgId, fundingSourceId: owned.id, month, submittedAt: now })
    .onConflictDoUpdate({
      target: [monthStatuses.orgId, monthStatuses.fundingSourceId, monthStatuses.month],
      set: { submittedAt: now },
    });

  // Submission is what makes a month's figures official, so it is where they are recorded
  // (D-68). Everything else in the app recomputes from live rows, which means a later
  // correction would otherwise rewrite what this month is said to have closed at.
  await captureMonthSnapshot(current.orgId, owned.id, month);

  revalidatePath("/", "layout");
  return ok();
}

/** Undo the marker, for a month marked by mistake. */
export async function clearMonthSubmittedAction(
  month: string,
  fundingSourceId: string,
): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isValidMonthKey(month)) return fail("That is not a valid month.");

  const owned = await requireOwnedFundingSource(current, fundingSourceId);
  if ("denied" in owned) return owned.denied;

  await db
    .update(monthStatuses)
    .set({ submittedAt: null })
    .where(
      and(
        eq(monthStatuses.orgId, current.orgId),
        eq(monthStatuses.fundingSourceId, owned.id),
        eq(monthStatuses.month, month),
      ),
    );

  // No longer claimed as sent, so figures labelled "as submitted" would assert something
  // untrue. The pinned artifact keeps the bytes that were actually delivered (R10.6).
  await discardMonthSnapshot(current.orgId, owned.id, month);

  revalidatePath("/", "layout");
  return ok();
}
