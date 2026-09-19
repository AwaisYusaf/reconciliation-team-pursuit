import { NextResponse, type NextRequest } from "next/server";

import { UI } from "@/src/domain/strings";
import { readCappedText } from "@/src/lib/json-request";
import { sameOrigin } from "@/src/lib/same-origin";
import { unlockSharedFile, type UnlockOutcome } from "@/src/modules/sharing/public";
import { clientIpFrom } from "@/src/services/client-ip";

import { sharePageWithNotice } from "../notices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A password is at most 128 characters; a body this size holds any real one with room to spare. */
const MAX_BODY_BYTES = 1_000;

/** `X-Robots-Tag` and `Referrer-Policy` come from `next.config.ts` for all of `/s/*`. */
const NO_STORE = { "Cache-Control": "private, no-store" };

type Context = { params: Promise<{ token: string }> };

/**
 * `POST /s/{token}/unlock` — the password form on a shared link (PHASE-12 P2, P7).
 *
 * Two callers, one check. The page's script sends JSON and shows the answer in place. A form
 * posted before that script loaded arrives urlencoded and is answered with a redirect, so the
 * password never ends up in a URL either way (`unlock-form.tsx`). The origin check stops another
 * site from spending a visitor's tries; the password itself is the protection. The body is read
 * with a hard cap whatever `Content-Length` claims: this route needs no account.
 */
export async function POST(request: NextRequest, context: Context) {
  const { token } = await context.params;
  const formPost = (request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded");

  if (!sameOrigin(request)) {
    return formPost ? seeOther(sharePageWithNotice(token, "refused")) : refusal(403);
  }

  const text = await readCappedText(request, MAX_BODY_BYTES);
  if (text === null) return formPost ? seeOther(sharePageWithNotice(token, "refused")) : refusal(413);

  let password: unknown;
  if (formPost) {
    password = new URLSearchParams(text).get("password");
  } else {
    try {
      password = (JSON.parse(text) as { password?: unknown } | null)?.password;
    } catch {
      return refusal(400);
    }
  }

  const result = await unlockSharedFile({ token, password, ip: clientIpFrom(request.headers) });
  return formPost ? asRedirect(token, result) : asJson(result);
}

function asJson(result: UnlockOutcome): NextResponse {
  switch (result.outcome) {
    case "unavailable":
      return NextResponse.json({ ok: false, error: UI.shareUnavailable }, { status: 404, headers: NO_STORE });
    case "too_many":
      return NextResponse.json({ ok: false, error: UI.shareTooManyTries }, { status: 429, headers: NO_STORE });
    case "wrong":
      return NextResponse.json({ ok: false, error: UI.sharePasswordWrong }, { headers: NO_STORE });
    case "open":
      return withCookie(NextResponse.json({ ok: true, url: result.url }, { headers: NO_STORE }), result);
  }
}

function asRedirect(token: string, result: UnlockOutcome): NextResponse {
  switch (result.outcome) {
    case "unavailable":
      return seeOther(`/s/${encodeURIComponent(token)}`);
    case "too_many":
      return seeOther(sharePageWithNotice(token, "wait"));
    case "wrong":
      return seeOther(sharePageWithNotice(token, "wrong"));
    case "open":
      return withCookie(seeOther(result.url), result);
  }
}

function withCookie(response: NextResponse, result: Extract<UnlockOutcome, { outcome: "open" }>): NextResponse {
  if (result.cookie) response.cookies.set(result.cookie.name, result.cookie.value, result.cookie.options);
  return response;
}

/** 303 so the browser follows with a GET. Relative, so nothing depends on the host behind Caddy. */
function seeOther(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: location, ...NO_STORE } });
}

/** A guard's refusal — never expected from the app's own page, so it says only what to do. */
function refusal(status: 400 | 403 | 413): NextResponse {
  return NextResponse.json({ ok: false, error: UI.requestRefused }, { status, headers: NO_STORE });
}
