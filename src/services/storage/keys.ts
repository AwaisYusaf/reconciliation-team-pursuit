/**
 * Object key construction (data-model §S3 layout).
 *
 * Keys are built here and nowhere else, and they never contain a user-supplied filename —
 * original names live in the database and are served through Content-Disposition. That
 * keeps PII out of keys, access logs and presigned URLs, and removes a whole class of
 * path-traversal and header-injection problems.
 *
 * Pure functions: no IO, so the rules are unit-testable.
 */
import type { MonthKey } from "@/src/domain/dates";
import { sanitiseForFilename } from "@/src/domain/strings";

export type DocumentScope = "proof" | "receipt" | "supporting";

/** Accepted upload types and their canonical extensions (R13.2). */
export const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "application/pdf": "pdf",
};

/** Maximum accepted size for any single upload (R13.2). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function isAllowedMimeType(mimeType: string): boolean {
  return mimeType in ALLOWED_MIME_TYPES;
}

export function extensionFor(mimeType: string): string {
  return ALLOWED_MIME_TYPES[mimeType] ?? "bin";
}

/** `org/{orgId}/months/{YYYY-MM}/expenses/{expenseId}/{scope}/{docId}.{ext}` */
export function expenseDocumentKey(input: {
  orgId: string;
  month: MonthKey;
  expenseId: string;
  scope: DocumentScope;
  docId: string;
  mimeType: string;
}): string {
  return [
    "org",
    input.orgId,
    "months",
    input.month,
    "expenses",
    input.expenseId,
    input.scope,
    `${input.docId}.${extensionFor(input.mimeType)}`,
  ].join("/");
}

/** `org/{orgId}/months/{YYYY-MM}/month-docs/{category}/{docId}.{ext}` */
export function monthDocumentKey(input: {
  orgId: string;
  month: MonthKey;
  category: string;
  docId: string;
  mimeType: string;
}): string {
  return [
    "org",
    input.orgId,
    "months",
    input.month,
    "month-docs",
    input.category,
    `${input.docId}.${extensionFor(input.mimeType)}`,
  ].join("/");
}

/** `org/{orgId}/months/{YYYY-MM}/generated/{fundingSourceId}/{type}[-{slug}]-{hash}.{ext}`
 *  (decision 2.9: expense/month document keys are unchanged; only generated artifacts, written
 *  from Phase 2 on, get this segment — existing rows keep their stored key.) */
export function generatedArtifactKey(input: {
  orgId: string;
  fundingSourceId: string;
  month: MonthKey;
  type: string;
  lineItemName?: string | null;
  inputsHash: string;
  extension: string;
}): string {
  const slug = input.lineItemName
    ? `-${sanitiseForFilename(input.lineItemName).replace(/\s+/g, "-").toLowerCase()}`
    : "";
  return [
    "org",
    input.orgId,
    "months",
    input.month,
    "generated",
    input.fundingSourceId,
    `${input.type}${slug}-${input.inputsHash}.${input.extension}`,
  ].join("/");
}

/** `org/{orgId}/months/{YYYY-MM}/signed-packets/{fundingSourceId}/{eventId}.pdf` (R10.7). */
export function signedPacketKey(input: {
  orgId: string;
  month: MonthKey;
  fundingSourceId: string;
  eventId: string;
}): string {
  return [
    "org",
    input.orgId,
    "months",
    input.month,
    "signed-packets",
    input.fundingSourceId,
    `${input.eventId}.pdf`,
  ].join("/");
}

/** Thumbnail beside its source object. */
export function thumbnailKey(objectKey: string): string {
  return `${objectKey.replace(/\.[^./]+$/, "")}.thumb.jpg`;
}

/**
 * Guard for any key that arrives from outside the key builders.
 *
 * The client never sends keys — it references documents by id — but download and
 * processing paths take keys from the database, and this makes the organisation prefix
 * an enforced invariant rather than an assumption.
 */
export function keyBelongsToOrg(key: string, orgId: string): boolean {
  if (key.includes("..") || key.startsWith("/")) return false;
  return key.startsWith(`org/${orgId}/`);
}
