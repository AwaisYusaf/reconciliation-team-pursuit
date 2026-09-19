import { NextResponse, type NextRequest } from "next/server";

import { UI } from "@/src/domain/strings";
import { sameOrigin } from "@/src/lib/same-origin";
import { unlockSharedFile } from "@/src/modules/sharing/public";
import { clientIpFrom } from "@/src/services/client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

/**
 * `POST /s/{token}/unlock` — the password form on a shared link (PHASE-12 P2, P7).
 *
 * A route handler rather than a Server Action because the answer sets a cookie and sends the
 * visitor to a file; see `unlock-form.tsx`. The origin check only stops another site from
 * spending a visitor's tries — the password itself is the protection.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Bad origin." }, { status: 403, headers: PRIVATE });
  }
  if (Number(request.headers.get("content-length") ?? "0") > 1_000) {
    return NextResponse.json({ ok: false, error: "That request is too large." }, { status: 413, headers: PRIVATE });
  }

  let password: unknown;
  try {
    password = ((await request.json()) as { password?: unknown }).password;
  } catch {
    return NextResponse.json({ ok: false, error: "That request was malformed." }, { status: 400, headers: PRIVATE });
  }

  const { token } = await context.params;
  const result = await unlockSharedFile({ token, password, ip: clientIpFrom(request.headers) });

  switch (result.outcome) {
    case "unavailable":
      return NextResponse.json({ ok: false, error: UI.shareUnavailable }, { status: 404, headers: PRIVATE });
    case "too_many":
      return NextResponse.json({ ok: false, error: UI.shareTooManyTries }, { status: 429, headers: PRIVATE });
    case "wrong":
      return NextResponse.json({ ok: false, error: UI.sharePasswordWrong }, { headers: PRIVATE });
    case "open": {
      const response = NextResponse.json({ ok: true, url: result.url }, { headers: PRIVATE });
      if (result.cookie) response.cookies.set(result.cookie.name, result.cookie.value, result.cookie.options);
      return response;
    }
  }
}
