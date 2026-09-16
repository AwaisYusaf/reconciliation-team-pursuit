import "server-only";

/**
 * Locking a reconciled month (R10.7, D-96).
 *
 * Exports only `lockMonth`, called by the upload route (`target=signed-packet`) because a signed
 * copy can be up to 25 MB, more than a Server Action accepts. Deliberately not `"use server"`:
 * every export of such a module becomes a directly invocable endpoint, and `lockMonth` trusts
 * the org, user and funding source its caller already verified. The guard every protected write
 * runs, `monthLocked`, lives in `./month-guard.ts`.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { db } from "@/src/db";
import { monthLockEvents, monthStatuses } from "@/src/db/schema";
import type { MonthKey } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { monthLocked } from "@/src/modules/packet/month-guard";
import { loadPacketReadiness } from "@/src/modules/packet/queries";
import { captureMonthSnapshot } from "@/src/modules/packet/snapshot";
import { storage } from "@/src/services/storage/driver";
import {
  discardStored,
  orgStorageError,
  precheck,
  withOrgUploadLock,
} from "@/src/services/storage/documents";
import { inspectUpload } from "@/src/services/storage/inspect";
import { MAX_UPLOAD_BYTES, signedPacketKey } from "@/src/services/storage/keys";

export type LockResult = { ok: true } | { ok: false; error: string };

/**
 * Lock a month: store the signed copy, then in one transaction lock the row, refuse if already
 * locked or if the month has blocking (missing-document) records, and record the lock event
 * (plan §3.6–§3.7). Archived funding sources are allowed to lock (plan §7 Q3) — this is
 * intentionally not checked here, matching `ingestMonthDocument` leaving that refusal to its
 * caller (the upload route already refuses archived sources for `target=month`;
 * `target=signed-packet` deliberately does not, per the plan).
 *
 * `submitted_at` and the "as submitted" snapshot move together (PR #16 review — they used to
 * disagree, since the date was only set on first submission but the snapshot was re-captured on
 * every lock): a first lock of a month already submitted leaves BOTH alone; a first lock of a
 * month not yet submitted, or a lock after an unlock (a prior lock event exists), sets
 * `submitted_at` to now AND re-captures.
 */
export async function lockMonth(input: {
  orgId: string;
  userId: string;
  fundingSourceId: string;
  month: MonthKey;
  file: File;
}): Promise<LockResult> {
  const failure = precheck(input.file);
  if (failure) return { ok: false, error: failure };

  // Cheap rejection before inspection, same reasoning as the document ingestion paths.
  const fullError = await orgStorageError(db, input.orgId, 1);
  if (fullError) return { ok: false, error: fullError };

  const inspection = await inspectUpload({
    body: Buffer.from(await input.file.arrayBuffer()),
    declaredMimeType: input.file.type,
    // The signed packet is only stored and served back, never embedded into generated
    // documents — an owner-password-only PDF (which every viewer opens unprompted) is safe to
    // accept here even though it would not be for an expense/month upload.
    allowOwnerPasswordPdf: true,
  });
  if (!inspection.ok) return { ok: false, error: inspection.error };
  if (inspection.mimeType !== "application/pdf") {
    return { ok: false, error: UI.lockNotPdf };
  }
  if (inspection.body.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "That file is larger than 25 MB once converted for storage. Upload a smaller export.",
    };
  }

  const incomingBytes = inspection.body.byteLength;
  const eventId = uuidv7();
  const key = signedPacketKey({
    orgId: input.orgId,
    month: input.month,
    fundingSourceId: input.fundingSourceId,
    eventId,
  });

  const store = storage();
  await store.put({ key, body: inspection.body, contentType: inspection.mimeType });

  type LockOutcome = { refusal: string; recapture?: never } | { refusal?: never; recapture: boolean };

  const outcome = await db.transaction(async (tx) =>
    withOrgUploadLock(tx, input.orgId, async (): Promise<LockOutcome> => {
      const locked = await monthLocked(tx, input.orgId, [
        { fundingSourceId: input.fundingSourceId, month: input.month },
      ]);
      if (locked) return { refusal: UI.monthAlreadyLocked };

      // Prefer passing `tx` here rather than the bare connection: `loadPacketReadiness` runs
      // several selects, and reading them on a second pool connection while this transaction
      // already holds one risks the same pool-exhaustion deadlock `claimReferenceSeq` warns
      // about (`src/modules/expenses/references.ts:39-43`) if enough locks run concurrently.
      const readiness = await loadPacketReadiness(input.orgId, input.fundingSourceId, input.month, tx);
      if (readiness.blocking.length > 0) return { refusal: UI.lockNeedsDocuments };

      const quotaError = await orgStorageError(tx, input.orgId, incomingBytes);
      if (quotaError) return { refusal: quotaError };

      // Decide submitted_at and whether to re-capture BEFORE inserting this lock's own event
      // below, since a prior-lock-event check has to see prior events only (PR #16 review):
      // - not yet submitted: this is a first submission — set submitted_at to now and capture.
      // - already submitted, first lock (no prior lock event exists): leave both alone — the
      //   figures and the date it was submitted must keep agreeing (plan §7 Q1/Q2).
      // - a lock after an unlock (a prior lock event exists, i.e. was locked before): treat it
      //   as a fresh submission too — set submitted_at to now and re-capture.
      const [row] = await tx
        .select({ submittedAt: monthStatuses.submittedAt })
        .from(monthStatuses)
        .where(
          and(
            eq(monthStatuses.orgId, input.orgId),
            eq(monthStatuses.fundingSourceId, input.fundingSourceId),
            eq(monthStatuses.month, input.month),
          ),
        )
        .limit(1);
      const [priorLock] = await tx
        .select({ id: monthLockEvents.id })
        .from(monthLockEvents)
        .where(
          and(
            eq(monthLockEvents.orgId, input.orgId),
            eq(monthLockEvents.fundingSourceId, input.fundingSourceId),
            eq(monthLockEvents.month, input.month),
            isNotNull(monthLockEvents.s3Key),
          ),
        )
        .limit(1);
      const recapture = row?.submittedAt == null || priorLock !== undefined;

      const now = new Date();
      await tx
        .update(monthStatuses)
        .set({
          lockedAt: now,
          ...(recapture ? { submittedAt: now } : {}),
        })
        .where(
          and(
            eq(monthStatuses.orgId, input.orgId),
            eq(monthStatuses.fundingSourceId, input.fundingSourceId),
            eq(monthStatuses.month, input.month),
          ),
        );

      await tx.insert(monthLockEvents).values({
        id: eventId,
        orgId: input.orgId,
        fundingSourceId: input.fundingSourceId,
        month: input.month,
        actorUserId: input.userId,
        s3Key: key,
        filename: input.file.name,
        sizeBytes: incomingBytes,
      });

      return { recapture };
    }),
  );

  if (outcome.refusal) {
    await discardStored(key, false);
    return { ok: false, error: outcome.refusal };
  }

  // Re-captures the "as submitted" figures — what the City approved (plan §7 Q1) — only when
  // this lock is a fresh submission (see the comment above): the first lock of a month already
  // submitted deliberately leaves the existing snapshot alone, so its figures keep agreeing
  // with the submitted_at date that also wasn't touched. Its own transaction, so it cannot run
  // inside the one above.
  //
  // The lock has already committed by this point. Letting a failure here escape would answer
  // the upload with "That file could not be saved", although the month is locked with its copy
  // stored — and retrying would then be refused as already locked. The cost of swallowing it is
  // only a stale comparison: the Dashboard's "changed since submitted" notice keeps comparing
  // against the previous capture until the month is next locked or submitted.
  if (outcome.recapture) {
    try {
      await captureMonthSnapshot(input.orgId, input.fundingSourceId, input.month);
    } catch {
      console.error("lock snapshot failed", { orgId: input.orgId, month: input.month });
    }
  }

  return { ok: true };
}
