import "server-only";

/**
 * Document ingestion — receive a file, prove it, store it, record it (R4.6, D-30).
 *
 * Uploads are proxied through the server rather than presigned direct to storage. Every
 * upload has to be inspected and normalised server-side anyway, and presigning would move
 * the bytes client → storage → server → storage; proxying moves them client → server →
 * storage. It is one request instead of two, there is no window in which an orphaned draft
 * object exists, and the S3 and filesystem drivers behave identically.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { db } from "@/src/db";
import { isUuid } from "@/src/lib/ids";
import { monthLabel } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { isKnownSupportingDocType } from "@/src/modules/settings/labels";
import { monthLocked } from "@/src/modules/packet/month-guard";
import {
  expenseDocuments,
  expenseDraftDocuments,
  expenseDrafts,
  expenses,
  monthDocuments,
  organizations,
} from "@/src/db/schema";
import type { MonthDocumentCategory } from "@/src/db/schema";
import type { MonthKey } from "@/src/domain/dates";

import { storage } from "./driver";
import { inspectUpload } from "./inspect";
import {
  draftDocumentKey,
  expenseDocumentKey,
  isAllowedMimeType,
  isUndeclaredMimeType,
  MAX_UPLOAD_BYTES,
  monthDocumentKey,
  thumbnailKey,
  type DocumentScope,
} from "./keys";

export type IngestResult =
  | { ok: true; documentId: string }
  | { ok: false; error: string };

/**
 * Per-expense budgets (R13.1).
 *
 * A count was the wrong unit. One expense legitimately holds every Lyft receipt for a month,
 * and a low file count forced people to invent extra line items purely to get their evidence
 * in — the platform shaping the accounting rather than recording it.
 *
 * What actually costs something is bytes (storage) and **pages** (packet assembly: every
 * uploaded page becomes one rasterised packet page). So both are budgeted, and the file count
 * survives only as a runaway guard — a loop uploading forever, not a person attaching receipts.
 */
export const MAX_EXPENSE_BYTES = 200 * 1024 * 1024;
export const MAX_EXPENSE_PAGES = 300;
export const MAX_DOCUMENTS_PER_EXPENSE = 500;
/** Per-month cap on packet-level documents (R13.1). */
export const MAX_MONTH_DOCUMENTS = 50;
/** Total stored bytes per organisation (R13.1) — a soft cap that blocks new uploads. */
export const MAX_ORG_BYTES = 5 * 1024 * 1024 * 1024;

function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * Whether this expense has room for another file, given what it already holds (R13.1).
 *
 * Pure, so the budget arithmetic is testable without a database — and so the same numbers can
 * be shown in the UI before someone picks a file rather than after they save.
 */
export function expenseBudgetError(
  current: { files: number; bytes: number; pages: number },
  incoming: { bytes: number; pages: number },
): string | null {
  if (current.bytes + incoming.bytes > MAX_EXPENSE_BYTES) {
    return (
      `This expense already holds ${megabytes(current.bytes)} MB of its ` +
      `${megabytes(MAX_EXPENSE_BYTES)} MB limit, and this file would put it over. Split the ` +
      "receipts across two expenses, or remove a file already attached."
    );
  }
  if (current.pages + incoming.pages > MAX_EXPENSE_PAGES) {
    return (
      `This expense already holds ${current.pages} pages of its ${MAX_EXPENSE_PAGES}-page limit, ` +
      `and this file adds ${incoming.pages}. Every page becomes a page of the packet, so the ` +
      "limit keeps it readable. Split the receipts across two expenses, or remove a file " +
      "already attached."
    );
  }
  if (current.files >= MAX_DOCUMENTS_PER_EXPENSE) {
    return `An expense can hold at most ${MAX_DOCUMENTS_PER_EXPENSE} files. Split them across two expenses.`;
  }
  return null;
}

/** Take back objects written for an upload whose row was then refused. Shared with `lockMonth`
 *  (`src/modules/packet/lock.ts`), which stores the signed packet the same store-then-transaction
 *  way and needs the same cleanup on refusal. */
export async function discardStored(key: string, hadThumbnail: boolean): Promise<void> {
  const store = storage();
  await Promise.allSettled([
    store.delete(key),
    ...(hadThumbnail ? [store.delete(thumbnailKey(key))] : []),
  ]);
}

/** Either the connection or an open transaction — the quota is read through both. */
type Queryable = Pick<typeof db, "select" | "execute">;

/**
 * Serialise every upload for one organisation so a count or a byte total cannot be read by
 * two uploads that then both insert past the cap.
 *
 * Keyed on the **organisation**, not the expense: the per-parent caps would only need the
 * parent, but the 5 GB quota is org-wide, so uploads to two different expenses race on it
 * just as readily. One lock covering both is simpler than two with an ordering rule, and
 * uploads are not a throughput path.
 *
 * A transaction-scoped advisory lock rather than a row lock: month documents have no single
 * parent row to lock, and locking `organizations` would contend with unrelated writes like
 * the active-month change. The key is hashed, so a collision only over-serialises two
 * unrelated organisations briefly — it never lets one through.
 *
 * Exported for `lockMonth` (`src/modules/packet/lock.ts`), which stores the signed packet
 * through this same lock rather than its own.
 */
export async function withOrgUploadLock<T>(
  tx: Queryable,
  orgId: string,
  run: () => Promise<T>,
): Promise<T> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`uploads:${orgId}`}))`);
  return run();
}

export function storageQuotaError(usedBytes: number, incomingBytes: number): string | null {
  if (usedBytes + incomingBytes <= MAX_ORG_BYTES) return null;

  const usedMb = Math.round(usedBytes / (1024 * 1024));
  const limitMb = Math.round(MAX_ORG_BYTES / (1024 * 1024));
  return (
    `Your organization is using ${usedMb} MB of its ${limitMb} MB of storage, and this file ` +
    `would put it over. Remove some documents from an earlier month, or contact support at ` +
    `${UI.supportEmail}.`
  );
}

/**
 * An organisation's total stored bytes (R13.1): expense documents, month documents and signed
 * packets, including thumbnails. Generated artifacts are excluded — they are the system's own
 * output and can be regenerated, so charging the organisation for them would make a month
 * unmanageable as its packet grew. `null` means no such organisation row.
 *
 * Shared by `orgStorageError` (the quota check) and `loadOrgUsage` (`src/modules/admin/
 * queries.ts`, Phase 9), so the number the admin dashboard shows is the same one the quota
 * enforces by construction, rather than by two copies of this SQL staying in sync by hand.
 */
export async function orgStorageBytes(tx: Queryable, orgId: string): Promise<number | null> {
  const rows = await tx
    .select({
      // Every table that owns a stored object has to be named here, or its bytes are real
      // spend the cap can never see.
      //
      // Counted PER OBJECT, not per row, which is why this is a union grouped by key rather
      // than one sum per table added together. One stored file is now pointed at by several rows on
      // purpose: the invoice an import owns becomes the receipt on every expense that invoice
      // produced, and a draft's own files are re-pointed onto the expense at approval, both
      // keeping the same `s3_key` instead of storing the bytes again. Adding the rows up would
      // charge a 25-line invoice 26 times for one 1.3 MB file — the very cost that re-pointing
      // exists to avoid — and the admin usage figure, which reads this same function, would
      // report storage the bucket does not hold.
      used: sql<number>`
        coalesce((
          select sum(bytes) from (
            select s3_key, max(bytes) as bytes from (
              select s3_key, size_bytes + thumbnail_bytes as bytes
                from expense_documents where org_id = ${orgId}
              union all
              select s3_key, size_bytes + thumbnail_bytes
                from expense_draft_documents where org_id = ${orgId}
              union all
              select s3_key, size_bytes + thumbnail_bytes
                from month_documents where org_id = ${orgId}
              union all
              select s3_key, size_bytes + thumbnail_bytes
                from expense_imports where org_id = ${orgId}
              union all
              select s3_key, coalesce(size_bytes, 0)
                from month_lock_events where org_id = ${orgId} and s3_key is not null
              union all
              select avatar_key, avatar_bytes
                from users where org_id = ${orgId} and avatar_key is not null
            ) every_row
            group by s3_key
          ) per_object
        ), 0)
      `,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!rows[0]) return null;
  return Number(rows[0].used);
}

/**
 * Whether the organisation has room for another file (R13.1).
 *
 * Takes the executor so the authoritative check can run inside the upload lock; called on
 * the bare connection first only as a cheap rejection.
 *
 * Exported for `lockMonth` (`src/modules/packet/lock.ts`), which charges the signed copy
 * against this same quota rather than a separate one.
 */
export async function orgStorageError(
  tx: Queryable,
  orgId: string,
  incomingBytes: number,
): Promise<string | null> {
  const used = await orgStorageBytes(tx, orgId);
  // No organisation row means the caller's session outlived the org. Treat it as no room
  // rather than destructuring undefined and surfacing a 500.
  if (used === null) return "That organization no longer exists.";
  return storageQuotaError(used, incomingBytes);
}

/** Size and declared-type check before the (possibly expensive) inspection. Exported for
 *  `lockMonth` (`src/modules/packet/lock.ts`), which runs the same precheck on the signed
 *  packet before its own PDF-only inspection. */
export function precheck(file: { size: number; type: string }): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return "That file is larger than the 25 MB limit. Upload a smaller copy, for example a lower-resolution scan.";
  }
  // An empty type means the browser had no mapping for the extension, not that the file is
  // unsupported — common for HEIC and for files with no extension at all. The magic-byte
  // inspection that follows is the authority on what this actually is, so the decision is
  // left to it rather than guessed from a hint the browser declined to give.
  if (!isUndeclaredMimeType(file.type) && !isAllowedMimeType(file.type)) {
    return "That file type is not supported. Upload a PNG, JPG, HEIC or PDF.";
  }
  return null;
}

/**
 * Attach a document to an expense.
 *
 * The expense must already exist and belong to the caller's organisation — the id is
 * re-checked here rather than trusted, so a guessed id from another organisation cannot
 * be written to.
 */
export async function ingestExpenseDocument(input: {
  orgId: string;
  expenseId: string;
  scope: DocumentScope;
  supportingType?: string | null;
  file: File;
}): Promise<IngestResult> {
  const failure = precheck(input.file);
  if (failure) return { ok: false, error: failure };

  if (input.scope === "supporting") {
    // The type prints in the packet, so it must be one the organisation offers.
    if (!input.supportingType) return { ok: false, error: "Choose a document type first." };
    if (!(await isKnownSupportingDocType(input.orgId, input.supportingType))) {
      return { ok: false, error: "That document type is no longer in use. Choose another type and add the file again." };
    }
  }

  // No attaching files to a trashed expense.
  const owner = await db
    .select({
      month: expenses.month,
      fundingSourceId: expenses.fundingSourceId,
      noReceipt: expenses.noReceipt,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.id, input.expenseId),
        eq(expenses.orgId, input.orgId),
        isNull(expenses.deletedAt),
      ),
    )
    .limit(1);
  const expense = owner[0];
  if (!expense) return { ok: false, error: "That expense no longer exists." };

  // R4.2: "no receipt available" and an attached receipt are mutually exclusive. This is
  // the only path that creates receipt rows, so enforcing it here closes the hole for
  // every caller rather than trusting each one to check.
  if (input.scope === "receipt" && expense.noReceipt) {
    return {
      ok: false,
      error: 'This expense is marked "No receipt available". Uncheck it before attaching a receipt.',
    };
  }

  // A full organisation is rejected before inspection, which costs a sharp decode of up to
  // MAX_PIXELS and a re-encode. Safe as an early-out because a stored file is never zero
  // bytes, so "already at the cap" can never become "fits" after inspection — and it keeps
  // the useful message: at the cap, no file will attach, which matters more than whatever
  // is wrong with this one.
  const fullError = await orgStorageError(db, input.orgId, 1);
  if (fullError) return { ok: false, error: fullError };

  const inspection = await inspectUpload({
    body: Buffer.from(await input.file.arrayBuffer()),
    declaredMimeType: input.file.type,
  });
  if (!inspection.ok) return { ok: false, error: inspection.error };

  // The per-file cap has to be re-applied to the stored length, not just the uploaded one:
  // re-encoding WebP or HEIC to JPEG grows the file (~1.4x measured), so a 24 MB WebP would
  // otherwise pass a 25 MB limit and land well past it — and `size_bytes` is the size the
  // UI shows, next to copy promising 25 MB.
  if (inspection.body.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error:
        "Once converted for storage, that file is larger than the 25 MB limit. Upload a smaller copy, for example a lower-resolution photo.",
    };
  }

  // Everything this upload puts in the bucket: the document and, for an image, its thumbnail.
  const incomingBytes = inspection.body.byteLength + (inspection.thumbnail?.byteLength ?? 0);

  const documentId = uuidv7();
  const key = expenseDocumentKey({
    orgId: input.orgId,
    month: expense.month,
    expenseId: input.expenseId,
    scope: input.scope,
    docId: documentId,
    mimeType: inspection.mimeType,
  });

  const store = storage();
  await store.put({ key, body: inspection.body, contentType: inspection.mimeType });
  if (inspection.thumbnail) {
    await store.put({
      key: thumbnailKey(key),
      body: inspection.thumbnail,
      contentType: "image/jpeg",
    });
  }

  // The count above is a fast rejection, not the decision: it is read outside any transaction,
  // so two concurrent uploads can both see room. The cap is re-checked here under a lock, with
  // the sort order taken from the same read — otherwise both rows also land on the same
  // position, and packet document order is defined by it (R10.1 determinism).
  const placed = await db.transaction(async (tx) =>
    withOrgUploadLock(tx, input.orgId, async (): Promise<string | null> => {
      // The pre-inspection read above is a fast rejection only — it is read outside any
      // transaction, before the slow inspection, so a move landing meanwhile would leave it
      // stale. Re-read the expense's current month/source/deletedAt here, inside the
      // transaction and before any write (R10.7, D-96), and guard on THAT — not on `expense`
      // above. Deliberately not a row lock on the expense: `updateExpenseAction` locks
      // `month_statuses` first and the expense row second, and taking the expense row lock
      // before `monthLocked` here would risk a deadlock against that order.
      const [current] = await tx
        .select({
          month: expenses.month,
          fundingSourceId: expenses.fundingSourceId,
          deletedAt: expenses.deletedAt,
        })
        .from(expenses)
        .where(and(eq(expenses.id, input.expenseId), eq(expenses.orgId, input.orgId)))
        .limit(1);
      if (!current || current.deletedAt) return "That expense no longer exists.";

      const locked = await monthLocked(tx, input.orgId, [
        { fundingSourceId: current.fundingSourceId, month: current.month },
      ]);
      if (locked) return UI.monthLocked(monthLabel(locked.month));

      // `monthLocked` above took its own row lock (on `month_statuses`, not on the expense), so
      // there was a window between the read just above and that lock in which the expense could
      // have moved to a different month again. Close it: re-read and refuse if it moved, rather
      // than attach the file to a month that is no longer the one just checked.
      const [after] = await tx
        .select({ month: expenses.month, fundingSourceId: expenses.fundingSourceId })
        .from(expenses)
        .where(and(eq(expenses.id, input.expenseId), eq(expenses.orgId, input.orgId)))
        .limit(1);
      if (
        !after ||
        after.month !== current.month ||
        after.fundingSourceId !== current.fundingSourceId
      ) {
        return "That expense just changed. Try again.";
      }

      const [held] = await tx
        .select({
          files: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(size_bytes + thumbnail_bytes), 0)::bigint`,
          pages: sql<number>`coalesce(sum(coalesce(page_count, 1)), 0)::int`,
          // The next POSITION, which is not the same as the count: removing a file leaves a
          // gap, so a count would hand the new row a position another row still holds, and
          // packet document order is defined by this column (R10.1 determinism). Read off the
          // same locked select as the budget, so the two cannot disagree.
          nextSortOrder: sql<number>`coalesce(max(sort_order), -1) + 1`,
        })
        .from(expenseDocuments)
        .where(eq(expenseDocuments.expenseId, input.expenseId));

      // Inside the lock, because a byte or page budget races exactly like a count does — two
      // uploads reading the same total and both inserting overshoot by a whole file each.
      const budgetError = expenseBudgetError(
        { files: Number(held.files), bytes: Number(held.bytes), pages: Number(held.pages) },
        { bytes: incomingBytes, pages: inspection.pageCount ?? 1 },
      );
      if (budgetError) return budgetError;

      const quotaError = await orgStorageError(tx, input.orgId, incomingBytes);
      if (quotaError) return quotaError;

      await tx.insert(expenseDocuments).values({
        id: documentId,
        orgId: input.orgId,
        expenseId: input.expenseId,
        kind: input.scope,
        supportingType: input.scope === "supporting" ? (input.supportingType ?? null) : null,
        // Stored only after the bytes are proven, so the documentation gate can trust it (R4.6).
        status: "attached",
        s3Key: key,
        filename: input.file.name,
        mimeType: inspection.mimeType,
        sizeBytes: inspection.body.byteLength,
        thumbnailBytes: inspection.thumbnail?.byteLength ?? 0,
        pageCount: inspection.pageCount,
        widthPx: inspection.widthPx,
        heightPx: inspection.heightPx,
        sortOrder: Number(held.nextSortOrder),
      });
      return null;
    }),
  );

  if (placed) {
    // Refused after the bytes were written; take them back out rather than leaving the
    // organisation charged for an object no row points at.
    await discardStored(key, inspection.thumbnail !== null);
    return { ok: false, error: placed };
  }

  return { ok: true, documentId };
}

/** Attach a packet-level document to a month (R11.2). */
export async function ingestMonthDocument(input: {
  orgId: string;
  fundingSourceId: string;
  month: string;
  category: MonthDocumentCategory;
  title?: string | null;
  file: File;
}): Promise<IngestResult> {
  const failure = precheck(input.file);
  if (failure) return { ok: false, error: failure };

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(monthDocuments)
    .where(
      and(
        eq(monthDocuments.orgId, input.orgId),
        eq(monthDocuments.fundingSourceId, input.fundingSourceId),
        eq(monthDocuments.month, input.month),
      ),
    );
  if (total >= MAX_MONTH_DOCUMENTS) {
    return {
      ok: false,
      error: `A month can hold at most ${MAX_MONTH_DOCUMENTS} documents. Remove one before adding another.`,
    };
  }

  // A full organisation is rejected before inspection, which costs a sharp decode of up to
  // MAX_PIXELS and a re-encode. Safe as an early-out because a stored file is never zero
  // bytes, so "already at the cap" can never become "fits" after inspection — and it keeps
  // the useful message: at the cap, no file will attach, which matters more than whatever
  // is wrong with this one.
  const fullError = await orgStorageError(db, input.orgId, 1);
  if (fullError) return { ok: false, error: fullError };

  const inspection = await inspectUpload({
    body: Buffer.from(await input.file.arrayBuffer()),
    declaredMimeType: input.file.type,
  });
  if (!inspection.ok) return { ok: false, error: inspection.error };

  // The per-file cap has to be re-applied to the stored length, not just the uploaded one:
  // re-encoding WebP or HEIC to JPEG grows the file (~1.4x measured), so a 24 MB WebP would
  // otherwise pass a 25 MB limit and land well past it — and `size_bytes` is the size the
  // UI shows, next to copy promising 25 MB.
  if (inspection.body.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error:
        "Once converted for storage, that file is larger than the 25 MB limit. Upload a smaller copy, for example a lower-resolution photo.",
    };
  }

  // Everything this upload puts in the bucket: the document and, for an image, its thumbnail.
  const incomingBytes = inspection.body.byteLength + (inspection.thumbnail?.byteLength ?? 0);

  const documentId = uuidv7();
  const key = monthDocumentKey({
    orgId: input.orgId,
    month: input.month,
    category: input.category,
    docId: documentId,
    mimeType: inspection.mimeType,
  });

  const store = storage();
  await store.put({ key, body: inspection.body, contentType: inspection.mimeType });
  if (inspection.thumbnail) {
    await store.put({
      key: thumbnailKey(key),
      body: inspection.thumbnail,
      contentType: "image/jpeg",
    });
  }

  const placed = await db.transaction(async (tx) =>
    withOrgUploadLock(tx, input.orgId, async (): Promise<string | null> => {
      // First thing inside the transaction, before any write (R10.7, D-96) — inside the
      // advisory lock, matching lockMonth's own order.
      const locked = await monthLocked(tx, input.orgId, [
        { fundingSourceId: input.fundingSourceId, month: input.month },
      ]);
      if (locked) return UI.monthLocked(monthLabel(locked.month));

      const [{ live }] = await tx
        .select({ live: sql<number>`count(*)::int` })
        .from(monthDocuments)
        .where(
          and(
            eq(monthDocuments.orgId, input.orgId),
            eq(monthDocuments.fundingSourceId, input.fundingSourceId),
            eq(monthDocuments.month, input.month),
          ),
        );
      if (live >= MAX_MONTH_DOCUMENTS) {
        return `A month can hold at most ${MAX_MONTH_DOCUMENTS} documents. Remove one before adding another.`;
      }

      const quotaError = await orgStorageError(tx, input.orgId, incomingBytes);
      if (quotaError) return quotaError;

      await tx.insert(monthDocuments).values({
        id: documentId,
        orgId: input.orgId,
        fundingSourceId: input.fundingSourceId,
        month: input.month,
        category: input.category,
        title: input.title?.trim() || null,
        status: "attached",
        s3Key: key,
        filename: input.file.name,
        mimeType: inspection.mimeType,
        sizeBytes: inspection.body.byteLength,
        thumbnailBytes: inspection.thumbnail?.byteLength ?? 0,
        pageCount: inspection.pageCount,
        widthPx: inspection.widthPx,
        heightPx: inspection.heightPx,
        sortOrder: live,
      });
      return null;
    }),
  );

  if (placed) {
    await discardStored(key, inspection.thumbnail !== null);
    return { ok: false, error: placed };
  }

  return { ok: true, documentId };
}

/**
 * Remove the stored object and its thumbnail for an already-known key. Best-effort; the
 * nightly sweep is the backstop for whichever of the two calls fails.
 *
 * Callers delete the DB row themselves — inside their own transaction, after the month-lock
 * guard (R10.7) — and call this only once that has committed, so a refused or failed write
 * never loses the bytes.
 */
export async function deleteStoredObjects(key: string): Promise<void> {
  // One object can now be pointed at by more than one row: the invoice an import owns becomes
  // the receipt on every expense the invoice produced, re-pointed rather than copied, and a
  // draft's own files are re-pointed onto the expense at approval the same way. Deleting the
  // object because ONE of those rows went would take the file out from under the others,
  // leaving rows the documentation gate (R4.6) trusts with nothing behind them.
  //
  // Checked here, in the one place every delete path already routes through, rather than in
  // each caller — `removeExpenseDocumentAction`, `permanentlyDeleteExpenseAction`,
  // `updateExpenseAction`'s no-receipt sweep, `discardDraftAction` and `removeDraftDocumentAction`
  // all reach this function, and a guard in one of them would leave the rest wrong.
  if (await objectStillReferenced(key)) return;

  const store = storage();
  await Promise.allSettled([store.delete(key), store.delete(thumbnailKey(key))]);
}

/**
 * Whether any row still points at this stored object.
 *
 * Deliberately not org-scoped: a key is unique across the bucket, and the question being asked
 * is "would deleting this file break something", which does not depend on whose file it is.
 *
 * **This list and `orgStorageBytes`'s must name the same tables.** They answer two halves of
 * one question — what is stored, and what would still be pointed at — so a table counted here
 * but not there is billed for after it is deleted, and one counted there but not here can have
 * its file deleted while a row still names it. `month_lock_events` was in that second state:
 * counted, unchecked. Nothing shares a signed-packet key today, which is exactly why it would
 * have gone unnoticed until something did. Profile photos joined both lists together (D-119).
 */
async function objectStillReferenced(key: string): Promise<boolean> {
  const [row] = await db
    .select({
      referenced: sql<boolean>`
        exists (select 1 from expense_documents where s3_key = ${key})
        or exists (select 1 from expense_draft_documents where s3_key = ${key})
        or exists (select 1 from expense_imports where s3_key = ${key})
        or exists (select 1 from month_documents where s3_key = ${key})
        or exists (select 1 from month_lock_events where s3_key = ${key})
        or exists (select 1 from users where avatar_key = ${key})
      `,
    })
    .from(organizations)
    .limit(1);
  return Boolean(row?.referenced);
}

/**
 * Make an already-stored invoice the receipt on an expense, WITHOUT storing it again.
 *
 * The invoice is stored once, owned by `expense_imports`, and one bill can produce fifty
 * expenses. Re-uploading it per expense stored fifty-one copies of the same file and charged
 * every one of them against the organisation's 5 GB cap — on a real 1.3 MB invoice of 25 lines
 * that is ~34 MB for one bill, and "Approve all ready" did 25 downloads and 25 uploads inside
 * one request. Pointing the row at the key the import already holds is what `approveDraftAction`
 * already does for a draft's own files (D-116), applied to the invoice itself.
 *
 * The object therefore outlives any single row that points at it, which `deleteStoredObjects`
 * accounts for: it refuses to remove an object another row still references.
 *
 * Takes the executor so it can run inside the approving transaction, where the expense it is
 * attaching to does not exist outside yet.
 */
export async function attachImportAsReceipt(
  tx: Pick<typeof db, "select" | "insert">,
  input: {
    orgId: string;
    expenseId: string;
    imported: {
      s3Key: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      /** Zero for a PDF, and for an import stored before imports kept one. */
      thumbnailBytes: number;
      pageCount: number | null;
    };
  },
): Promise<void> {
  const [held] = await tx
    .select({ next: sql<number>`coalesce(max(sort_order), -1) + 1` })
    .from(expenseDocuments)
    .where(eq(expenseDocuments.expenseId, input.expenseId));

  await tx.insert(expenseDocuments).values({
    orgId: input.orgId,
    expenseId: input.expenseId,
    kind: "receipt",
    supportingType: null,
    // The bytes are already stored and already proven, by the import that wrote them.
    status: "attached",
    s3Key: input.imported.s3Key,
    filename: input.imported.filename,
    mimeType: input.imported.mimeType,
    sizeBytes: input.imported.sizeBytes,
    // The import's own thumbnail, not a new one: it was made and stored once, when the invoice
    // was. Zero for a PDF, which has none — the table shows it a glyph rather than asking for
    // one. Carried here because the quota counts an object by the rows that point at it, and a
    // row claiming zero while the object beside it holds bytes is spend the cap cannot see.
    thumbnailBytes: input.imported.thumbnailBytes,
    pageCount: input.imported.pageCount,
    widthPx: null,
    heightPx: null,
    sortOrder: Number(held?.next ?? 0),
  });
}

/**
 * Attach a file to a DRAFT, which is not an expense yet (Phase 14).
 *
 * The same shape as `ingestExpenseDocument`, against `expense_draft_documents` instead:
 * `expense_documents.expense_id` is NOT NULL, so a draft has nothing to point at until it is
 * approved. Approval re-points this object at the new expense rather than uploading it again.
 *
 * Differs from the expense path in exactly one way: there is no month lock to respect, because
 * a draft is in no month total (D-115). Everything else is the same and deliberately so — the
 * org storage quota, the per-expense file/byte/page budget, the upload lock, and storing the
 * object before the row so a refusal leaves neither behind. Approval re-points these rows at a
 * real expense without re-checking any of it, so anything relaxed here is simply relaxed on
 * the expense that follows.
 */
export async function ingestDraftDocument(input: {
  orgId: string;
  draftId: string;
  scope: DocumentScope;
  supportingType?: string | null;
  file: File;
}): Promise<IngestResult> {
  // Shape-checked before it reaches a uuid column: a malformed id must read as "not found",
  // not raise a Postgres 22P02 that the route turns into a 500 — which would also make a
  // malformed id distinguishable from a well-formed one belonging to another organisation.
  if (!isUuid(input.draftId)) return { ok: false, error: "That draft no longer exists." };

  const failure = precheck(input.file);
  if (failure) return { ok: false, error: failure };

  if (input.scope === "supporting") {
    if (!input.supportingType) return { ok: false, error: "Choose a document type first." };
    if (!(await isKnownSupportingDocType(input.orgId, input.supportingType))) {
      return {
        ok: false,
        error: "That document type is no longer in use. Choose another type and add the file again.",
      };
    }
  }

  const [owner] = await db
    .select({ month: expenseDrafts.month })
    .from(expenseDrafts)
    .where(and(eq(expenseDrafts.id, input.draftId), eq(expenseDrafts.orgId, input.orgId)))
    .limit(1);
  if (!owner) return { ok: false, error: "That draft no longer exists." };

  const inspection = await inspectUpload({
    body: Buffer.from(await input.file.arrayBuffer()),
    declaredMimeType: input.file.type,
  });
  if (!inspection.ok) return { ok: false, error: inspection.error };
  if (inspection.body.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That file is larger than 25 MB." };
  }

  const docId = uuidv7();
  const key = draftDocumentKey({
    orgId: input.orgId,
    month: owner.month as MonthKey,
    draftId: input.draftId,
    scope: input.scope,
    docId,
    mimeType: inspection.mimeType,
  });
  const incomingBytes = inspection.body.byteLength + (inspection.thumbnail?.byteLength ?? 0);

  // Stored BEFORE the row, and taken back out if the row is refused — the same order as
  // `ingestExpenseDocument` and `ingestMonthDocument`, and deliberately not the reverse.
  // Committing the row first leaves the worse artifact of the two: a row saying `attached`
  // with no bytes behind it, which approval copies straight into `expense_documents`, where
  // the documentation gate (R4.6) trusts it and the packet build is what discovers the object
  // is missing. An orphan object is merely wasted space, and this path deletes it here.
  const store = storage();
  await store.put({ key, body: inspection.body, contentType: inspection.mimeType });
  if (inspection.thumbnail) {
    await store.put({
      key: thumbnailKey(key),
      body: inspection.thumbnail,
      contentType: "image/jpeg",
    });
  }

  const refusal = await db.transaction(async (tx) =>
    withOrgUploadLock(tx, input.orgId, async (): Promise<string | null> => {
      // Under the lock for the same reason the expense path is: the quota, the budget and the
      // sort order are all totals read before an insert, and two concurrent uploads reading
      // the same total both overshoot by a whole file.
      const [held] = await tx
        .select({
          files: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(size_bytes + thumbnail_bytes), 0)::bigint`,
          pages: sql<number>`coalesce(sum(coalesce(page_count, 1)), 0)::int`,
          // See the same field on the expense path: a position, not a count. It matters here
          // too because `approveDraftAction` carries this value straight into
          // `expense_documents`, where the packet's order reads it.
          nextSortOrder: sql<number>`coalesce(max(sort_order), -1) + 1`,
        })
        .from(expenseDraftDocuments)
        .where(eq(expenseDraftDocuments.draftId, input.draftId));

      // The SAME per-expense budget the expense path enforces. A draft has no packet of its
      // own, but approval re-points every one of these rows at a real expense — so a draft
      // allowed to exceed the budget would simply move the breach to the moment it becomes an
      // expense, where nothing checks it again.
      const budgetError = expenseBudgetError(
        { files: Number(held.files), bytes: Number(held.bytes), pages: Number(held.pages) },
        { bytes: incomingBytes, pages: inspection.pageCount ?? 1 },
      );
      if (budgetError) return budgetError;

      const quotaError = await orgStorageError(tx, input.orgId, incomingBytes);
      if (quotaError) return quotaError;

      await tx.insert(expenseDraftDocuments).values({
        id: docId,
        orgId: input.orgId,
        draftId: input.draftId,
        kind: input.scope,
        supportingType: input.scope === "supporting" ? input.supportingType! : null,
        // Stored only after the bytes are proven, so the gate can trust it once approval
        // copies this row across (R4.6).
        status: "attached",
        s3Key: key,
        filename: input.file.name,
        mimeType: inspection.mimeType,
        sizeBytes: inspection.body.byteLength,
        thumbnailBytes: inspection.thumbnail?.byteLength ?? 0,
        pageCount: inspection.pageCount,
        widthPx: inspection.widthPx,
        heightPx: inspection.heightPx,
        sortOrder: Number(held.nextSortOrder),
      });
      return null;
    }),
  );

  if (refusal) {
    await discardStored(key, inspection.thumbnail !== null);
    return { ok: false, error: refusal };
  }

  return { ok: true, documentId: docId };
}
