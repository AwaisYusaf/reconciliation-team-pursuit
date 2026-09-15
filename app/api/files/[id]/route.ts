import { and, eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/src/db";
import { expenseDocuments, monthDocuments, monthLockEvents } from "@/src/db/schema";
import { attachmentHeader, INLINE_DISPOSITION } from "@/src/lib/http";
import { isUuid } from "@/src/lib/ids";
import { getSession } from "@/src/services/auth/session";
import { storage } from "@/src/services/storage/driver";
import { keyBelongsToOrg, thumbnailKey } from "@/src/services/storage/keys";
import { canPreviewInline } from "@/src/services/storage/preview";

export const runtime = "nodejs";

/**
 * Serve a stored document by id.
 *
 * The client never sees or sends object keys — it references documents by id, and the key
 * is looked up under the session's organisation. `?thumb=1` returns the preview instead of
 * the original. Originals download as attachments unless `?inline=1` asks for one of the
 * renderable types, which the viewer overlay uses to show a receipt without downloading it.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return new NextResponse("Not signed in", { status: 401 });

  const { id } = await context.params;
  // A malformed id would raise a Postgres 22P02 out of an unguarded handler; the intent
  // here is an indistinguishable "not found".
  if (!isUuid(id)) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  const wantsThumbnail = url.searchParams.get("thumb") === "1";
  // Rendered in the viewer overlay instead of downloaded. Honoured only for the types the
  // allowlist in `preview.ts` calls safe; anything else still downloads.
  const wantsInline = url.searchParams.get("inline") === "1";

  const [expenseDoc] = await db
    .select({ key: expenseDocuments.s3Key, name: expenseDocuments.filename, type: expenseDocuments.mimeType })
    .from(expenseDocuments)
    .where(and(eq(expenseDocuments.id, id), eq(expenseDocuments.orgId, session.orgId)))
    .limit(1);

  const [monthDoc] = expenseDoc
    ? [undefined]
    : await db
        .select({ key: monthDocuments.s3Key, name: monthDocuments.filename, type: monthDocuments.mimeType })
        .from(monthDocuments)
        .where(and(eq(monthDocuments.id, id), eq(monthDocuments.orgId, session.orgId)))
        .limit(1);

  // Signed packets have no `mime_type` column — they are always the PDF `lockMonth` stored
  // (R10.7). Only a lock row (`s3_key IS NOT NULL`) is ever downloadable; an unlock row has none.
  const [lockEvent] =
    (expenseDoc ?? monthDoc)
      ? [undefined]
      : await db
          .select({ key: monthLockEvents.s3Key, name: monthLockEvents.filename })
          .from(monthLockEvents)
          .where(
            and(
              eq(monthLockEvents.id, id),
              eq(monthLockEvents.orgId, session.orgId),
              isNotNull(monthLockEvents.s3Key),
            ),
          )
          .limit(1);
  const signedPacket = lockEvent?.key
    ? { key: lockEvent.key, name: lockEvent.name ?? "Signed packet.pdf", type: "application/pdf" }
    : undefined;

  const document = expenseDoc ?? monthDoc ?? signedPacket;
  // Indistinguishable from "belongs to another organisation", so a probe learns nothing.
  if (!document) return new NextResponse("Not found", { status: 404 });

  // Belt and braces: the key came from our own row, but the prefix is still enforced.
  if (!keyBelongsToOrg(document.key, session.orgId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const key = wantsThumbnail ? thumbnailKey(document.key) : document.key;
  const store = storage();

  let body: Buffer;
  try {
    body = await store.get(key);
  } catch {
    // PDFs have no thumbnail. Serving the original here would send megabytes of PDF
    // labelled as a JPEG into an <img>, which can only ever render broken — so callers
    // get an honest 404 and show a document glyph instead.
    return new NextResponse("Not found", { status: 404 });
  }

  const contentType = wantsThumbnail ? "image/jpeg" : document.type;
  const disposition = wantsThumbnail
    ? INLINE_DISPOSITION
    : wantsInline && canPreviewInline(document.type)
      ? INLINE_DISPOSITION
      : attachmentHeader(document.name);

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "Content-Length": String(body.byteLength),
      // Never let a browser sniff a different type out of a user-supplied file.
      "X-Content-Type-Options": "nosniff",
      // Documents are private; never let a shared cache hold one.
      "Cache-Control": "private, max-age=300",
    },
  });
}
