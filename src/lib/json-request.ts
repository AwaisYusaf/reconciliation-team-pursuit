import "server-only";

/**
 * Reading a POST body in a route handler, with the guards a Server Action gets for free: the
 * origin check and a size cap. Used by the routes that exist only because their work runs too
 * long for a Server Action (the monthly summary write, sharing a file) and by the public password
 * form on a shared link.
 */
import { NextResponse, type NextRequest } from "next/server";

import { UI } from "@/src/domain/strings";
import { SESSION_EXPIRED } from "@/src/lib/action-result";
import { routeSession } from "@/src/lib/route-session";
import { sameOrigin } from "@/src/lib/same-origin";

/**
 * The body as text, or null once it passes `maxBytes`.
 *
 * Read chunk by chunk and abandoned at the cap. A declared `Content-Length` is only a claim: a
 * chunked body carries none, and `request.json()` would buffer whatever arrives (PHASE-12 review:
 * a 2 MB chunked body reached the public unlock route's token lookup). The declared length is
 * still checked first, so an honest oversized request is refused without reading anything.
 */
export async function readCappedText(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? "0") > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type BodyRefusal = { response: NextResponse };

function refuse(status: 400 | 403 | 413, headers?: HeadersInit): BodyRefusal {
  return {
    response: NextResponse.json({ ok: false, error: UI.requestRefused }, { status, headers }),
  };
}

/** Origin, then size, then JSON. The refusal is a ready response in the caller's shape. */
export async function readJsonBody(
  request: NextRequest,
  maxBytes: number,
  headers?: HeadersInit,
): Promise<{ body: unknown } | BodyRefusal> {
  if (!sameOrigin(request)) return refuse(403, headers);
  const text = await readCappedText(request, maxBytes);
  if (text === null) return refuse(413, headers);
  try {
    return { body: JSON.parse(text) };
  } catch {
    return refuse(400, headers);
  }
}

/**
 * `readJsonBody` behind a signed-in session. The session is checked before anything is read, so
 * a signed-out caller can't make the server read a body at all.
 */
export async function readSignedInJson(
  request: NextRequest,
  maxBytes: number,
): Promise<{ body: unknown } | BodyRefusal> {
  const session = await routeSession("json");
  if (!session) {
    return { response: NextResponse.json({ ok: false, error: SESSION_EXPIRED }, { status: 401 }) };
  }
  if ("denied" in session) return { response: session.denied };
  return readJsonBody(request, maxBytes);
}
