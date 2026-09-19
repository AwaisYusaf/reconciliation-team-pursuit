import { NextResponse, type NextRequest } from "next/server";

import { readSignedInJson } from "@/src/lib/json-request";
import { createSharedLinkAction } from "@/src/modules/sharing/actions";

export const runtime = "nodejs";
/** Assembling a big packet can take a minute or two, as a download does. */
export const maxDuration = 600;

/**
 * Share a month's packet or summary (PHASE-12 P12). A route handler rather than a Server Action:
 * a build this long as an action would block every other action in the tab (Next's sequential
 * dispatch), the same reason `app/api/monthly-summary/write/route.ts` exists.
 *
 * `createSharedLinkAction` does every real check and never throws for an expected refusal.
 * `request.signal` is not observed: leaving the page must not abandon a build half-stored.
 */
export async function POST(request: NextRequest) {
  const read = await readSignedInJson(request, 2_000);
  if ("response" in read) return read.response;
  return NextResponse.json(
    await createSharedLinkAction(read.body as Parameters<typeof createSharedLinkAction>[0]),
  );
}
