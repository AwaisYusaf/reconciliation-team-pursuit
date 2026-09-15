import "server-only";

/**
 * Locking a reconciled month (R10.7, D-96).
 *
 * Deliberately not `"use server"`: every export in a `"use server"` module becomes a directly
 * invocable endpoint, and `monthLocked` is a guard meant to be called from inside another
 * write's own transaction (the upload route, and — from Phase 1b on — the expense/recurring
 * modules), not from the client.
 */
import { and, eq, sql } from "drizzle-orm";
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
 * locked or if the month has blocking (missing-document) records, mark it submitted if it
 * wasn't, and record the lock event (plan §3.6–§3.7). Archived funding sources are allowed to
 * lock (plan §7 Q3) — this is intentionally not checked here, matching `ingestMonthDocument`
 * leaving that refusal to its caller (the upload route already refuses archived sources for
 * `target=month`; `target=signed-packet` deliberately does not, per the plan).
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

  const refusal = await db.transaction(async (tx) =>
    withOrgUploadLock(tx, input.orgId, async (): Promise<string | null> => {
      const locked = await monthLocked(tx, input.orgId, [
        { fundingSourceId: input.fundingSourceId, month: input.month },
      ]);
      if (locked) return UI.monthAlreadyLocked;

      // Prefer passing `tx` here rather than the bare connection: `loadPacketReadiness` runs
      // several selects, and reading them on a second pool connection while this transaction
      // already holds one risks the same pool-exhaustion deadlock `claimReferenceSeq` warns
      // about (`src/modules/expenses/references.ts:39-43`) if enough locks run concurrently.
      const readiness = await loadPacketReadiness(input.orgId, input.fundingSourceId, input.month, tx);
      if (readiness.blocking.length > 0) return UI.lockNeedsDocuments;

      const quotaError = await orgStorageError(tx, input.orgId, incomingBytes);
      if (quotaError) return quotaError;

      const now = new Date();
      await tx
        .update(monthStatuses)
        .set({
          lockedAt: now,
          // Only if it wasn't already submitted — re-locking keeps the original date (plan §7 Q2).
          submittedAt: sql`coalesce(${monthStatuses.submittedAt}, ${now})`,
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

      return null;
    }),
  );

  if (refusal) {
    await discardStored(key, false);
    return { ok: false, error: refusal };
  }

  // Re-captures the "as submitted" figures — what the City approved (plan §7 Q1). Its own
  // transaction, so it cannot run inside the one above.
  //
  // The lock has already committed by this point. Letting a failure here escape would answer
  // the upload with "That file could not be saved", although the month is locked with its copy
  // stored — and retrying would then be refused as already locked. The cost of swallowing it is
  // only a stale comparison: the Dashboard's "changed since submitted" notice keeps comparing
  // against the previous capture until the month is next locked or submitted.
  try {
    await captureMonthSnapshot(input.orgId, input.fundingSourceId, input.month);
  } catch {
    console.error("lock snapshot failed", { orgId: input.orgId, month: input.month });
  }

  return { ok: true };
}
