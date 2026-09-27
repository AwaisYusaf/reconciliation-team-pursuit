import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { v7 as uuidv7 } from "uuid";

import { db } from "@/src/db";
import { users } from "@/src/db/schema";
import { SESSION_EXPIRED } from "@/src/lib/action-result";
import { INLINE_DISPOSITION } from "@/src/lib/http";
import { routeSession, routeSessionAnyPlan } from "@/src/lib/route-session";
import { sameOrigin } from "@/src/lib/same-origin";
import { consume } from "@/src/services/rate-limit";
import { normaliseAvatar } from "@/src/services/storage/avatar";
import { deleteStoredObjects, orgStorageError, withOrgUploadLock } from "@/src/services/storage/documents";
import { storage } from "@/src/services/storage/driver";
import {
  avatarKey,
  avatarVersionOf,
  isAllowedAvatarMimeType,
  keyBelongsToOrg,
  MAX_AVATAR_BYTES,
} from "@/src/services/storage/keys";

export const runtime = "nodejs";

const NOT_FOUND = "No profile photo.";
const TOO_BIG = "That photo is over 5 MB. Choose a smaller one.";

/**
 * Room for the multipart envelope around the file itself, so a photo right at the 5 MB ceiling
 * is not refused for its boundary lines and headers.
 */
const MULTIPART_ALLOWANCE = 64 * 1024;

/**
 * The signed-in person's own profile photo.
 *
 * Deliberately has no user id in the path. An avatar endpoint that takes one is an
 * enumeration surface — it would answer "does this user exist" for every id guessed, across
 * organisations. Everything here reads the id from the session instead, so a request can only
 * ever reach its own row and there is nothing to guess.
 *
 * POST and DELETE carry the same guards as every other cookie-authenticated upload route
 * (`app/api/files/upload/route.ts`): the origin is checked, the body is capped before
 * `formData()` buffers it, and the rate is limited. The bytes are decoded and re-encoded rather
 * than trusted (`normaliseAvatar`, D-119), and the stored size counts against the organisation's
 * storage like any other object.
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
  if (!session) return new NextResponse(SESSION_EXPIRED, { status: 401 });

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
  // Paid only: the photo shows in the unpaid plan page's header (GET), but changing it is using
  // the app like anything else (Phase 16 §4.7).
  const session = await routeSession("json");
  if (!session) return NextResponse.json({ ok: false, error: SESSION_EXPIRED }, { status: 401 });
  if ("denied" in session) return session.denied;

  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Bad origin." }, { status: 403 });
  }

  const limit = consume("avatarUpload", session.userId);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many photo uploads. Wait a while, then try again." },
      { status: 429 },
    );
  }

  // Before `formData()`, which buffers the whole body: Next applies its body limit to Server
  // Actions only, never to route handlers.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_AVATAR_BYTES + MULTIPART_ALLOWANCE) {
    return NextResponse.json({ ok: false, error: TOO_BIG }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "That upload was malformed." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Choose a photo to upload." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json({ ok: false, error: TOO_BIG }, { status: 400 });
  }
  // A cheap first refusal on the declared type. Not the decision: `normaliseAvatar` decodes the
  // bytes and is what actually refuses an SVG, whatever it was labelled.
  if (!isAllowedAvatarMimeType(file.type)) {
    return NextResponse.json(
      { ok: false, error: "Profile photos can be PNG, JPG or WebP." },
      { status: 400 },
    );
  }

  const photo = await normaliseAvatar(Buffer.from(await file.arrayBuffer()));
  if (!photo.ok) return NextResponse.json({ ok: false, error: photo.error }, { status: 400 });

  const key = avatarKey({
    orgId: session.orgId,
    userId: session.userId,
    uploadId: uuidv7(),
    mimeType: photo.mimeType,
  });

  // Stored before the row, and taken back out if the row is refused: the same order as every
  // other upload path. An orphaned object is wasted space; a row naming bytes that were never
  // written is a broken photo.
  const store = storage();
  await store.put({ key, body: photo.body, contentType: photo.mimeType });

  let outcome: { ok: true; previousKey: string | null } | { ok: false; error: string };
  try {
    outcome = await db.transaction((tx) =>
      withOrgUploadLock(tx, session.orgId, async () => {
        // Locked, so two uploads racing each other replace one photo each in turn. Without it
        // both read the same previous key, both delete it, and the loser's new object is left
        // with nothing pointing at it.
        const [current] = await tx
          .select({ key: users.avatarKey, bytes: users.avatarBytes })
          .from(users)
          .where(eq(users.id, session.userId))
          .for("update");
        if (!current) return { ok: false as const, error: SESSION_EXPIRED };

        // Replacing a photo frees the old one's bytes, so only the growth is new spend. Charging
        // the whole new photo would refuse a like-for-like swap for an organisation at its cap.
        const growth = Math.max(0, photo.body.byteLength - current.bytes);
        const quotaError = await orgStorageError(tx, session.orgId, growth);
        if (quotaError) return { ok: false as const, error: quotaError };

        await tx
          .update(users)
          .set({ avatarKey: key, avatarBytes: photo.body.byteLength })
          .where(eq(users.id, session.userId));
        return { ok: true as const, previousKey: current.key };
      }),
    );
  } catch (error) {
    await deleteStoredObjects(key);
    throw error;
  }

  if (!outcome.ok) {
    await deleteStoredObjects(key);
    return NextResponse.json({ ok: false, error: outcome.error }, { status: 400 });
  }

  // After the row moved on, never before: if this fails the photo still works and one object is
  // left over, where deleting first would leave the row pointing at nothing.
  await removeOwnObject(outcome.previousKey, session.orgId);

  return NextResponse.json({ ok: true, version: avatarVersionOf(key) });
}

export async function DELETE(request: Request) {
  const session = await routeSession("json");
  if (!session) return NextResponse.json({ ok: false, error: SESSION_EXPIRED }, { status: 401 });
  if ("denied" in session) return session.denied;

  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Bad origin." }, { status: 403 });
  }

  const previousKey = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ key: users.avatarKey })
      .from(users)
      .where(eq(users.id, session.userId))
      .for("update");
    await tx
      .update(users)
      .set({ avatarKey: null, avatarBytes: 0 })
      .where(eq(users.id, session.userId));
    return current?.key ?? null;
  });

  await removeOwnObject(previousKey, session.orgId);

  return NextResponse.json({ ok: true });
}

/**
 * Best-effort removal of a photo this person no longer points at. A failure orphans one small
 * object; it never fails the request. Routed through `deleteStoredObjects`, which refuses to
 * remove anything a row still names.
 */
async function removeOwnObject(key: string | null, orgId: string): Promise<void> {
  if (!key || !keyBelongsToOrg(key, orgId)) return;
  try {
    await deleteStoredObjects(key);
  } catch {
    // Deliberately swallowed: the person's photo has already changed, which is what they asked
    // for, and failing the request over a leftover object would undo nothing.
  }
}
