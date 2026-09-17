import { NextResponse, type NextRequest } from "next/server";

import { sameOrigin } from "@/src/lib/same-origin";
import { writeSummaryAction } from "@/src/modules/monthly-summary/actions";
import { getSession } from "@/src/services/auth/session";

export const runtime = "nodejs";

/**
 * Writes a monthly summary from a route handler rather than a Server Action (Phase 11 §7.1,
 * Appendix A §6). A write can run up to ~4 minutes (P16); a Server Action that long blocks
 * every other Server Action in the tab (Next's sequential dispatch), which would break "the
 * rest of the app keeps working" while writing.
 *
 * `writeSummaryAction` already does every real check (shape, session, ownership, month, access,
 * single-flight, rate limit) and never throws — this only adds the guards a route handler needs
 * that a Server Action gets for free: same-origin and a body size cap. `request.signal` is
 * deliberately not observed: leaving the page must not cancel a run already billed.
 */
export async function POST(request: NextRequest) {
  // Session before the body is read, as the read-amounts route does: a chunked body carries no
  // content-length, so the size cap below can't stop a signed-out client making us buffer it.
  if (!(await getSession())) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Bad origin." }, { status: 403 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 10_000) {
    return NextResponse.json({ ok: false, error: "That request is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "That request was malformed." }, { status: 400 });
  }

  return NextResponse.json(await writeSummaryAction(body as Parameters<typeof writeSummaryAction>[0]));
}
