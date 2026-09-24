import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/src/db";
import { users } from "@/src/db/schema";
import { INLINE_DISPOSITION } from "@/src/lib/http";
import { getSession } from "@/src/services/auth/session";
import { storage } from "@/src/services/storage/driver";
import { keyBelongsToOrg } from "@/src/services/storage/keys";

export const runtime = "nodejs";

const SIGNED_OUT = "You've been signed out. Sign in and try again.";
const NOT_FOUND = "No profile photo.";

/**
 * A colleague's profile photo, for the places that name who did something — the audit trail
 * and the users list.
 *
 * **Keyed, not id'd, on purpose.** `/api/me/avatar` takes no identifier at all, and its own
 * note explains why: an endpoint that accepts a user id answers "does this user exist" for
 * every id guessed. This one takes the storage key instead, which is
 * `org/{orgId}/users/{userId}/avatar/{uploadId}.{ext}` — the uploadId is a uuid, so there is
 * nothing to guess, and a caller only ever learns a key by being served a page that already
 * decided to show them that person.
 *
 * Three checks, and the third is the one that matters:
 *
 *  1. Signed in at all.
 *  2. The key is under the caller's own organisation — defence in depth, and it rejects
 *     traversal (`..`) and absolute paths before any lookup.
 *  3. The key is genuinely some user's `avatar_key` in that organisation. Without this, the
 *     first two would let any signed-in person pass *any* key under their own org — a receipt,
 *     a signed packet — and have it streamed back. The org prefix says where an object lives,
 *     not what it is.
 *
 * Every rejection is the same 404 with the same body. A 403 for "not your org" and a 404 for
 * "no such photo" would be the enumeration signal this endpoint is shaped to avoid.
 */
function contentTypeFor(key: string): string {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse(SIGNED_OUT, { status: 401 });

  const key = new URL(request.url).searchParams.get("key");
  if (!key || !keyBelongsToOrg(key, session.orgId)) {
    return new NextResponse(NOT_FOUND, { status: 404 });
  }

  // The key must be a live avatar of a member of this organisation. Matching on `orgId` as
  // well as the key is belt and braces — the key already carries the org — but it means a key
  // that somehow crossed organisations still finds no row.
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.avatarKey, key), eq(users.orgId, session.orgId)))
    .limit(1);

  if (!owner) return new NextResponse(NOT_FOUND, { status: 404 });

  let body: Buffer;
  try {
    body = await storage().get(key);
  } catch {
    // The row points at an object that is gone. An honest 404 lets the avatar fall back to
    // initials rather than rendering a broken image.
    return new NextResponse(NOT_FOUND, { status: 404 });
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentTypeFor(key),
      "Content-Disposition": INLINE_DISPOSITION,
      "Content-Length": String(body.byteLength),
      "X-Content-Type-Options": "nosniff",
      // Private: a photo of a person is not something a shared cache may hold. The URL carries
      // the upload's uuid, so a replaced photo is a different URL and this never goes stale.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
