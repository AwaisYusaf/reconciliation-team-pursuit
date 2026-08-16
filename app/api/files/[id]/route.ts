import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/src/db";
import { expenseDocuments, monthDocuments } from "@/src/db/schema";
import { getSession } from "@/src/services/auth/session";
import { storage } from "@/src/services/storage/driver";
import { keyBelongsToOrg, thumbnailKey } from "@/src/services/storage/keys";

export const runtime = "nodejs";

/**
 * Serve a stored document by id.
 *
 * The client never sees or sends object keys — it references documents by id, and the key
 * is looked up under the session's organisation. `?thumb=1` returns the preview instead of
 * the original. Originals download as attachments; previews render inline.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return new NextResponse("Not signed in", { status: 401 });

  const { id } = await context.params;
  const url = new URL(request.url);
  const wantsThumbnail = url.searchParams.get("thumb") === "1";

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

  const document = expenseDoc ?? monthDoc;
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
    if (!wantsThumbnail) return new NextResponse("Not found", { status: 404 });
    // PDFs have no thumbnail; fall back to the original so callers need no special case.
    try {
      body = await store.get(document.key);
    } catch {
      return new NextResponse("Not found", { status: 404 });
    }
  }

  const contentType = wantsThumbnail ? "image/jpeg" : document.type;
  const disposition = wantsThumbnail
    ? "inline"
    : `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`;

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "Content-Length": String(body.byteLength),
      // Documents are private; never let a shared cache hold one.
      "Cache-Control": "private, max-age=300",
    },
  });
}
