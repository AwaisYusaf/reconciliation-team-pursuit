import "server-only";

/**
 * The guards a cookie-authenticated JSON POST route needs for itself — the ones a Server Action
 * gets for free. Used by the routes that exist only because their work runs too long for a Server
 * Action (the monthly summary write, sharing a file): each passes the body straight to the action
 * that does every real check.
 */
import { NextResponse, type NextRequest } from "next/server";

import { sameOrigin } from "@/src/lib/same-origin";
import { getSession } from "@/src/services/auth/session";

export async function readSignedInJson(
  request: NextRequest,
  maxBytes: number,
): Promise<{ body: unknown } | { response: NextResponse }> {
  // Session before the body is read: a chunked body carries no content-length, so the size cap
  // below can't stop a signed-out client making us buffer it.
  if (!(await getSession())) {
    return { response: NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 }) };
  }
  if (!sameOrigin(request)) {
    return { response: NextResponse.json({ ok: false, error: "Bad origin." }, { status: 403 }) };
  }
  if (Number(request.headers.get("content-length") ?? "0") > maxBytes) {
    return {
      response: NextResponse.json({ ok: false, error: "That request is too large." }, { status: 413 }),
    };
  }
  try {
    return { body: await request.json() };
  } catch {
    return {
      response: NextResponse.json({ ok: false, error: "That request was malformed." }, { status: 400 }),
    };
  }
}
