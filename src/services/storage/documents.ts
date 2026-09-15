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
import { monthLabel } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { isKnownSupportingDocType } from "@/src/modules/settings/labels";
import { monthLocked } from "@/src/modules/packet/month-guard";
import { expenseDocuments, expenses, monthDocuments, organizations } from "@/src/db/schema";
import type { MonthDocumentCategory } from "@/src/db/schema";

import { storage } from "./driver";
import { inspectUpload } from "./inspect";
import {
  expenseDocumentKey,
  isAllowedMimeType,
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
      `${megabytes(MAX_EXPENSE_BYTES)} MB, and this file would take it over. Split the receipts ` +
      "across two expenses, or remove something already attached."
    );
  }
  if (current.pages + incoming.pages > MAX_EXPENSE_PAGES) {
    return (
      `This expense already holds ${current.pages} pages of its ${MAX_EXPENSE_PAGES}, and this ` +
      `file adds ${incoming.pages}. Every page becomes a page of the packet, so the limit is ` +
      "there to keep the submission readable."
    );
  }
  if (current.files >= MAX_DOCUMENTS_PER_EXPENSE) {
    return `An expense can hold at most ${MAX_DOCUMENTS_PER_EXPENSE} files.`;
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
 * parent, but the 500 MB quota is org-wide, so uploads to two different expenses race on it
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
    `This organisation is using ${usedMb} MB of its ${limitMb} MB of storage, and this file ` +
    "would take it over. Remove some documents from an earlier month, or contact Mantaq."
  );
}

/**
 * Whether the organisation has room for another file (R13.1).
 *
 * Summed from the document rows rather than from the bucket: the rows are the record of
 * what this organisation is actually responsible for, and a stray object left behind by a
 * failed write should not count against them. Generated artifacts are excluded for the same
 * reason — they are the system's own output and can be regenerated, so charging the
 * organisation for them would make a month unmanageable as its packet grew.
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
  const rows = await tx
    .select({
      used: sql<number>`
        coalesce((select sum(size_bytes + thumbnail_bytes) from expense_documents where org_id = ${orgId}), 0)
        + coalesce((select sum(size_bytes + thumbnail_bytes) from month_documents where org_id = ${orgId}), 0)
        + coalesce((select sum(size_bytes) from month_lock_events where org_id = ${orgId}), 0)
      `,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  // No organisation row means the caller's session outlived the org. Treat it as no room
  // rather than destructuring undefined and surfacing a 500.
  if (!rows[0]) return "That organisation no longer exists.";
  return storageQuotaError(Number(rows[0].used), incomingBytes);
}

/** Size and declared-type check before the (possibly expensive) inspection. Exported for
 *  `lockMonth` (`src/modules/packet/lock.ts`), which runs the same precheck on the signed
 *  packet before its own PDF-only inspection. */
export function precheck(file: { size: number; type: string }): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return "That file is larger than 25 MB. Upload a smaller export.";
  }
  // An empty type means the browser had no mapping for the extension, not that the file is
  // unsupported — common for HEIC and for files with no extension at all. The magic-byte
  // inspection that follows is the authority on what this actually is, so the decision is
  // left to it rather than guessed from a hint the browser declined to give.
  if (file.type && !isAllowedMimeType(file.type)) {
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
      return { ok: false, error: "That document type is not one of yours." };
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
      error: 'This expense is marked "No receipt available" — untick that before attaching a receipt.',
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
      error: "That file is larger than 25 MB once converted for storage. Upload a smaller export.",
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
      // First thing inside the transaction, before any write (R10.7, D-96) — inside the
      // advisory lock, matching lockMonth's own order (plan's "Consistency rules").
      const locked = await monthLocked(tx, input.orgId, [
        { fundingSourceId: expense.fundingSourceId, month: expense.month },
      ]);
      if (locked) return UI.monthLocked(monthLabel(locked.month));

      const [held] = await tx
        .select({
          files: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(size_bytes + thumbnail_bytes), 0)::bigint`,
          pages: sql<number>`coalesce(sum(coalesce(page_count, 1)), 0)::int`,
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
        sortOrder: Number(held.files),
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
    return { ok: false, error: `A month can hold at most ${MAX_MONTH_DOCUMENTS} documents.` };
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
      error: "That file is larger than 25 MB once converted for storage. Upload a smaller export.",
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
        return `A month can hold at most ${MAX_MONTH_DOCUMENTS} documents.`;
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
 * Split out so a caller whose own DELETE already removed the DB row (e.g. via a foreign-key
 * cascade) can still clean up storage: `deleteExpenseDocument` below only works when the row
 * is deleted *by* that call, since it reads the key back from the same statement's
 * `RETURNING` — a row cascaded away by something else first is already gone, so that lookup
 * finds nothing and storage is silently never touched.
 */
export async function deleteStoredObjects(key: string): Promise<void> {
  const store = storage();
  await Promise.allSettled([store.delete(key), store.delete(thumbnailKey(key))]);
}

/** Remove a document and its stored objects. Best-effort on storage; the sweep is the backstop. */
export async function deleteExpenseDocument(orgId: string, documentId: string): Promise<boolean> {
  const rows = await db
    .delete(expenseDocuments)
    .where(and(eq(expenseDocuments.id, documentId), eq(expenseDocuments.orgId, orgId)))
    .returning({ key: expenseDocuments.s3Key });

  const row = rows[0];
  if (!row) return false;

  await deleteStoredObjects(row.key);
  return true;
}
