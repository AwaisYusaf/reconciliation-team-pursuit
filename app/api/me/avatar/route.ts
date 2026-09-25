import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { v7 as uuidv7 } from "uuid";

import { db } from "@/src/db";
import { users } from "@/src/db/schema";
import { INLINE_DISPOSITION } from "@/src/lib/http";
import { routeSessionAnyPlan } from "@/src/lib/route-session";
import { storage } from "@/src/services/storage/driver";
import {
  avatarKey,
  avatarVersionOf,
  isAllowedAvatarMimeType,
  keyBelongsToOrg,
  MAX_AVATAR_BYTES,
} from "@/src/services/storage/keys";

export const runtime = "nodejs";

const SIGNED_OUT = "You've been signed out. Sign in and try again.";
const NOT_FOUND = "No profile photo.";

/**
 * The signed-in person's own profile photo.
 *
 * Deliberately has no user id in the path. An avatar endpoint that takes one is an
 * enumeration surface — it would answer "does this user exist" for every id guessed, across
 * organisations. Everything here reads the id from the session instead, so a request can only
 * ever reach its own row and there is nothing to guess.
 */

/** Content type from the key's own extension; the key was built by `avatarKey` from a checked type. */
function contentTypeFor(key: string): string {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
}

export async function GET() {
  const session = await routeSessionAnyPlan();
  if (!session) return new NextResponse(SIGNED_OUT, { status: 401 });

  const [row] = await db
    .select({ key: users.avatarKey })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!row?.key) return new NextResponse(NOT_FOUND, { status: 404 });
  // Belt and braces, as the document route does: the key came from our own row, but the
  // organisation prefix stays an enforced invariant rather than an assumption.
  if (!keyBelongsToOrg(row.key, session.orgId)) {
    return new NextResponse(NOT_FOUND, { status: 404 });
  }

  let body: Buffer;
  try {
    body = await storage().get(row.key);
  } catch {
    // The row points at an object that is gone. An honest 404 lets the avatar fall back to
    // initials rather than rendering a broken image.
    return new NextResponse(NOT_FOUND, { status: 404 });
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentTypeFor(row.key),
      "Content-Disposition": INLINE_DISPOSITION,
      "Content-Length": String(body.byteLength),
      "X-Content-Type-Options": "nosniff",
      // Private: a photo of a person is not something a shared cache may hold. The URL
      // carries the key's uuid, so a replaced photo is a different URL and this can be
      // cached for longer than a document without ever going stale.
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function POST(request: Request) {
  const session = await routeSessionAnyPlan();
  if (!session) return NextResponse.json({ ok: false, error: SIGNED_OUT }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Choose a photo to upload." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      { ok: false, error: "That photo is over 5 MB. Choose a smaller one." },
      { status: 400 },
    );
  }
  if (!isAllowedAvatarMimeType(file.type)) {
    return NextResponse.json(
      { ok: false, error: "Profile photos can be PNG, JPG or WebP." },
      { status: 400 },
    );
  }

  const key = avatarKey({
    orgId: session.orgId,
    userId: session.userId,
    uploadId: uuidv7(),
    mimeType: file.type,
  });

  const store = storage();
  await store.put({
    key,
    body: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
  });

  // Read the old key before overwriting the row, so the object it points at can be removed.
  const [previous] = await db
    .select({ key: users.avatarKey })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  await db.update(users).set({ avatarKey: key }).where(eq(users.id, session.userId));

  // After the row is updated, never before: if this delete fails the photo still works and
  // one object is orphaned, where deleting first would leave the row pointing at nothing.
  await removeObject(previous?.key ?? null, session.orgId);

  return NextResponse.json({ ok: true, version: avatarVersionOf(key) });
}

export async function DELETE() {
  const session = await routeSessionAnyPlan();
  if (!session) return NextResponse.json({ ok: false, error: SIGNED_OUT }, { status: 401 });

  const [previous] = await db
    .select({ key: users.avatarKey })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  await db.update(users).set({ avatarKey: null }).where(eq(users.id, session.userId));
  await removeObject(previous?.key ?? null, session.orgId);

  return NextResponse.json({ ok: true });
}

/** Best-effort object removal. A failure here orphans one small object; it never fails the request. */
async function removeObject(key: string | null, orgId: string): Promise<void> {
  if (!key || !keyBelongsToOrg(key, orgId)) return;
  try {
    await storage().delete(key);
  } catch {
    // Deliberately swallowed: the user's photo has already changed, which is what they asked
    // for, and failing the request over a leftover object would undo nothing.
  }
}
