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
import { and, eq, sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { db } from "@/src/db";
import { isKnownSupportingDocType } from "@/src/modules/settings/labels";
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

/** Per-expense cap, so one record cannot balloon the packet (R13.1). */
export const MAX_DOCUMENTS_PER_EXPENSE = 20;
/** Per-month cap on packet-level documents (R13.1). */
export const MAX_MONTH_DOCUMENTS = 50;
/** Total stored bytes per organisation (R13.1) — a soft cap that blocks new uploads. */
export const MAX_ORG_BYTES = 500 * 1024 * 1024;

/**
 * Whether the organisation has room for another file (R13.1).
 *
 * Summed from the document rows rather than from the bucket: the rows are the record of
 * what this organisation is actually responsible for, and a stray object left behind by a
 * failed write should not count against them. Generated artifacts are excluded for the same
 * reason — they are the system's own output and can be regenerated, so charging the
 * organisation for them would make a month unmanageable as its packet grew.
 */
/** Take back objects written for an upload whose row was then refused. */
async function discardStored(key: string, hadThumbnail: boolean): Promise<void> {
  const store = storage();
  await Promise.allSettled([
    store.delete(key),
    ...(hadThumbnail ? [store.delete(thumbnailKey(key))] : []),
  ]);
}

/**
 * Serialise the "count, then insert" pair for one parent (expense, or month) so two uploads
 * cannot both read the same count and both insert past the cap.
 *
 * A transaction-scoped advisory lock rather than a row lock: month documents have no single
 * parent row to lock, and locking `organizations` would contend with unrelated writes like
 * the active-month change. The key is hashed, so a collision only over-serialises two
 * unrelated uploads for a few milliseconds — it never lets one through.
 */
async function withParentLock<T>(
  tx: { execute: (query: SQL) => Promise<unknown> },
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
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

async function orgStorageError(orgId: string, incomingBytes: number): Promise<string | null> {
  const [{ used }] = await db
    .select({
      used: sql<number>`
        coalesce((select sum(size_bytes) from expense_documents where org_id = ${orgId}), 0)
        + coalesce((select sum(size_bytes) from month_documents where org_id = ${orgId}), 0)
      `,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  return storageQuotaError(Number(used), incomingBytes);
}

function precheck(file: { size: number; type: string }): string | null {
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

  const owner = await db
    .select({ month: expenses.month, noReceipt: expenses.noReceipt })
    .from(expenses)
    .where(and(eq(expenses.id, input.expenseId), eq(expenses.orgId, input.orgId)))
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

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(expenseDocuments)
    .where(eq(expenseDocuments.expenseId, input.expenseId));
  if (total >= MAX_DOCUMENTS_PER_EXPENSE) {
    return { ok: false, error: `An expense can hold at most ${MAX_DOCUMENTS_PER_EXPENSE} files.` };
  }

  const inspection = await inspectUpload({
    body: Buffer.from(await input.file.arrayBuffer()),
    declaredMimeType: input.file.type,
  });
  if (!inspection.ok) return { ok: false, error: inspection.error };

  // Charged against the bytes actually stored, which is why this runs after inspection
  // rather than before it: HEIC and WebP are re-encoded to JPEG, so `file.size` is not what
  // lands in the bucket — and `size_bytes` below records the inspected length. Checking one
  // number and recording another let the running total drift from what was charged.
  const quotaError = await orgStorageError(input.orgId, inspection.body.byteLength);
  if (quotaError) return { ok: false, error: quotaError };

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
    withParentLock(tx, `expense-docs:${input.expenseId}`, async () => {
      const [{ live }] = await tx
        .select({ live: sql<number>`count(*)::int` })
        .from(expenseDocuments)
        .where(eq(expenseDocuments.expenseId, input.expenseId));
      if (live >= MAX_DOCUMENTS_PER_EXPENSE) return false;

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
        pageCount: inspection.pageCount,
        widthPx: inspection.widthPx,
        heightPx: inspection.heightPx,
        sortOrder: live,
      });
      return true;
    }),
  );

  if (!placed) {
    // Losing the race means the bytes were already written; take them back out rather than
    // leaving the organisation charged for an object no row points at.
    await discardStored(key, inspection.thumbnail !== null);
    return { ok: false, error: `An expense can hold at most ${MAX_DOCUMENTS_PER_EXPENSE} files.` };
  }

  return { ok: true, documentId };
}

/** Attach a packet-level document to a month (R11.2). */
export async function ingestMonthDocument(input: {
  orgId: string;
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
    .where(and(eq(monthDocuments.orgId, input.orgId), eq(monthDocuments.month, input.month)));
  if (total >= MAX_MONTH_DOCUMENTS) {
    return { ok: false, error: `A month can hold at most ${MAX_MONTH_DOCUMENTS} documents.` };
  }

  const inspection = await inspectUpload({
    body: Buffer.from(await input.file.arrayBuffer()),
    declaredMimeType: input.file.type,
  });
  if (!inspection.ok) return { ok: false, error: inspection.error };

  // Charged against the bytes actually stored, which is why this runs after inspection
  // rather than before it: HEIC and WebP are re-encoded to JPEG, so `file.size` is not what
  // lands in the bucket — and `size_bytes` below records the inspected length. Checking one
  // number and recording another let the running total drift from what was charged.
  const quotaError = await orgStorageError(input.orgId, inspection.body.byteLength);
  if (quotaError) return { ok: false, error: quotaError };

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
    withParentLock(tx, `month-docs:${input.orgId}:${input.month}`, async () => {
      const [{ live }] = await tx
        .select({ live: sql<number>`count(*)::int` })
        .from(monthDocuments)
        .where(and(eq(monthDocuments.orgId, input.orgId), eq(monthDocuments.month, input.month)));
      if (live >= MAX_MONTH_DOCUMENTS) return false;

      await tx.insert(monthDocuments).values({
        id: documentId,
        orgId: input.orgId,
        month: input.month,
        category: input.category,
        title: input.title?.trim() || null,
        status: "attached",
        s3Key: key,
        filename: input.file.name,
        mimeType: inspection.mimeType,
        sizeBytes: inspection.body.byteLength,
        pageCount: inspection.pageCount,
        widthPx: inspection.widthPx,
        heightPx: inspection.heightPx,
        sortOrder: live,
      });
      return true;
    }),
  );

  if (!placed) {
    await discardStored(key, inspection.thumbnail !== null);
    return { ok: false, error: `A month can hold at most ${MAX_MONTH_DOCUMENTS} documents.` };
  }

  return { ok: true, documentId };
}

/** Remove a document and its stored objects. Best-effort on storage; the sweep is the backstop. */
export async function deleteExpenseDocument(orgId: string, documentId: string): Promise<boolean> {
  const rows = await db
    .delete(expenseDocuments)
    .where(and(eq(expenseDocuments.id, documentId), eq(expenseDocuments.orgId, orgId)))
    .returning({ key: expenseDocuments.s3Key });

  const row = rows[0];
  if (!row) return false;

  const store = storage();
  await Promise.allSettled([store.delete(row.key), store.delete(thumbnailKey(row.key))]);
  return true;
}

/** Remove a month document and its stored objects. */
export async function deleteMonthDocument(orgId: string, documentId: string): Promise<boolean> {
  const rows = await db
    .delete(monthDocuments)
    .where(and(eq(monthDocuments.id, documentId), eq(monthDocuments.orgId, orgId)))
    .returning({ key: monthDocuments.s3Key });

  const row = rows[0];
  if (!row) return false;

  const store = storage();
  await Promise.allSettled([store.delete(row.key), store.delete(thumbnailKey(row.key))]);
  return true;
}
