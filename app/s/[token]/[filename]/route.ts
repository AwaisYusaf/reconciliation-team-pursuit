import type { NextRequest } from "next/server";

import { UI } from "@/src/domain/strings";
import { CONTENT_TYPES } from "@/src/generation/content-types";
import { attachmentHeader, inlineHeader } from "@/src/lib/http";
import { openShare, type PublicShare } from "@/src/modules/sharing/public";
import { UNLOCK_COOKIE } from "@/src/modules/sharing/unlock-cookie";
import { clientIpFrom } from "@/src/services/client-ip";
import { consume } from "@/src/services/rate-limit";
import { storage } from "@/src/services/storage/driver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string; filename: string }> };

/**
 * `/s/{token}/{filename}` — the shared file itself (PHASE-12 P10, D-112).
 *
 * Streams exactly the saved object the link points at. Nothing here builds a file: a missing
 * object is a 503, never a rebuild (`public-isolation.test.ts`). The filename segment is only for
 * the browser's tab and Save; the token alone decides access. No `Sec-Fetch-Site` check (P18):
 * links arrive from webmail, the cross-site navigation the download routes refuse.
 */
export async function GET(request: NextRequest, context: Context) {
  return serve(request, context, "GET");
}

/**
 * Answered from the object's size alone. Without this export Next answers HEAD by running GET,
 * so every link preview and mail scanner would open a 70 MB stream.
 */
export async function HEAD(request: NextRequest, context: Context) {
  return serve(request, context, "HEAD");
}

async function serve(request: NextRequest, context: Context, method: "GET" | "HEAD"): Promise<Response> {
  const budget = consume("shareOpen", clientIpFrom(request.headers));
  if (!budget.allowed) {
    return text(UI.shareTooManyOpens, 429, { "Retry-After": String(budget.retryAfterSeconds) });
  }

  const { token } = await context.params;
  const opened = await openShare(token, request.cookies.get(UNLOCK_COOKIE)?.value);
  // Unavailable or still locked: back to the link's page, which shows the password form or the
  // "no longer available" page. Relative, so it never depends on the host Next sees behind Caddy.
  if (opened.state !== "open") {
    return new Response(null, { status: 303, headers: { Location: `/s/${encodeURIComponent(token)}`, ...PRIVATE } });
  }

  const share = opened.share;
  const headers = fileHeaders(share);
  const store = storage();

  if (method === "HEAD") {
    const stat = await store.stat(share.s3Key);
    if (!stat) return text(UI.shareOpenFailed, 503);
    return new Response(null, { headers: { ...headers, "Content-Length": String(stat.size) } });
  }

  try {
    const { body, size } = await store.stream(share.s3Key);
    return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
  } catch (error) {
    // The token is a secret, so it never reaches the log; the share id identifies the row.
    console.error("shared file could not be read", { shareId: share.id, error });
    return text(UI.shareOpenFailed, 503);
  }
}

const PRIVATE = {
  // A link's file can change behind the same URL (Update shared file), and a stopped link must
  // stop at once, so nothing may cache it.
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

function fileHeaders(share: PublicShare): Record<string, string> {
  const pdf = share.artifactType === "packet_pdf";
  return {
    ...PRIVATE,
    "Content-Type": CONTENT_TYPES[pdf ? "pdf" : "xlsx"],
    // The PDF opens in the browser's own viewer, where the packet's links work; the viewer's Save
    // still uses this name. A workbook can't be shown, so it always downloads.
    "Content-Disposition": pdf ? inlineHeader(share.filename) : attachmentHeader(share.filename),
    "X-Content-Type-Options": "nosniff",
    // Sent whole: see PHASE-12 P10 for why ranges aren't offered.
    "Accept-Ranges": "none",
  };
}

function text(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { ...PRIVATE, "Content-Type": "text/plain; charset=utf-8", ...extra },
  });
}
