import { NextResponse, type NextRequest } from "next/server";

import { readSignedInJson } from "@/src/lib/json-request";
import { writeSummaryAction } from "@/src/modules/monthly-summary/actions";

export const runtime = "nodejs";

/**
 * Writes a monthly summary from a route handler rather than a Server Action (Phase 11 §7.1,
 * Appendix A §6). A write can run up to ~4 minutes (P16); a Server Action that long blocks
 * every other Server Action in the tab (Next's sequential dispatch), which would break "the
 * rest of the app keeps working" while writing.
 *
 * `writeSummaryAction` already does every real check (shape, session, ownership, month, access,
 * single-flight, rate limit) and never throws — `readSignedInJson` adds the guards a route
 * handler needs that a Server Action gets for free: same-origin and a body size cap.
 * `request.signal` is deliberately not observed: leaving the page must not cancel a run already
 * billed.
 */
export async function POST(request: NextRequest) {
  const read = await readSignedInJson(request, 10_000);
  if ("response" in read) return read.response;
  return NextResponse.json(await writeSummaryAction(read.body as Parameters<typeof writeSummaryAction>[0]));
}
