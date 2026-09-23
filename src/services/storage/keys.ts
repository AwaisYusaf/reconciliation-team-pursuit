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

/**
 * The browser had no type for the file, rather than declaring a wrong one. Chrome on Windows
 * gives a `.heic` the type "", which reaches the server as `application/octet-stream` — the
 * multipart default for a part with no type. Inspection's byte sniffing decides these.
 */
export function isUndeclaredMimeType(mimeType: string): boolean {
  return mimeType === "" || mimeType === "application/octet-stream";
}

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

/** `org/{orgId}/months/{YYYY-MM}/draft-docs/{draftId}/{scope}/{docId}.{ext}` (Phase 14) — a
 *  file added to a draft before it is an expense. Approval re-points the same object at the
 *  new expense rather than copying it, so this key outlives the draft row. */
export function draftDocumentKey(input: {
  orgId: string;
  month: MonthKey;
  draftId: string;
  scope: DocumentScope;
  docId: string;
  mimeType: string;
}): string {
  return [
    "org",
    input.orgId,
    "months",
    input.month,
    "draft-docs",
    input.draftId,
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

/** `org/{orgId}/months/{YYYY-MM}/expense-imports/{importId}.{ext}` (Phase 14) — one invoice,
 *  owned by the import row rather than any one expense (D-115); the filename lives on the row,
 *  never in the key. The extension comes from the inspected type, since an invoice may be a
 *  PDF or a photo of the bill. */
export function expenseImportKey(input: {
  orgId: string;
  month: MonthKey;
  importId: string;
  mimeType: string;
}): string {
  return [
    "org",
    input.orgId,
    "months",
    input.month,
    "expense-imports",
    `${input.importId}.${extensionFor(input.mimeType)}`,
  ].join("/");
}

/**
 * Image types a profile photo may be.
 *
 * A narrower list than `ALLOWED_MIME_TYPES` on purpose. PDF is not a picture. HEIC is left
 * out because it needs the decode step documents go through, and an avatar is not worth that
 * path. SVG is absent from both lists and must stay absent: an SVG is a document that can
 * carry script, and this one is served from the app's own origin.
 */
export const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Profile photos are small; a 5 MB ceiling is generous for one and bounds the upload. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export function isAllowedAvatarMimeType(mimeType: string): boolean {
  return (AVATAR_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * `org/{orgId}/users/{userId}/avatar/{uuid}.{ext}`
 *
 * Under the org prefix like every other key, so `keyBelongsToOrg` guards it unchanged. The
 * uuid makes each upload its own object: replacing a photo writes a new key and the old one
 * is deleted explicitly, rather than overwriting a path browsers have already cached.
 */
export function avatarKey(input: {
  orgId: string;
  userId: string;
  uploadId: string;
  mimeType: string;
}): string {
  return [
    "org",
    input.orgId,
    "users",
    input.userId,
    "avatar",
    `${input.uploadId}.${extensionFor(input.mimeType)}`,
  ].join("/");
}

/**
 * The uuid out of an avatar key, used as a cache-busting query parameter on the avatar URL.
 *
 * The avatar endpoint has no id in its path, so its URL is the same string for every photo
 * that person ever sets. This is what makes a replacement visible: the version changes, the
 * URL changes, and the browser fetches rather than serving the previous picture from cache.
 */
export function avatarVersionOf(objectKey: string): string {
  const name = objectKey.slice(objectKey.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
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
