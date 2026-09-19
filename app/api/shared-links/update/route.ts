import { NextResponse, type NextRequest } from "next/server";

import { readSignedInJson } from "@/src/lib/json-request";
import { updateSharedFileAction } from "@/src/modules/sharing/actions";
import { unexpectedShareFailure } from "@/src/modules/sharing/route-failure";

export const runtime = "nodejs";
/** Assembling a big packet can take a minute or two, as a download does. */
export const maxDuration = 600;

/**
 * Put the month's current file behind an existing link (PHASE-12 P12). A route handler rather
 * than a Server Action for the same reason as `../create/route.ts`.
 */
export async function POST(request: NextRequest) {
  const read = await readSignedInJson(request, 2_000);
  if ("response" in read) return read.response;
  try {
    return NextResponse.json(
      await updateSharedFileAction(read.body as Parameters<typeof updateSharedFileAction>[0]),
    );
  } catch (error) {
    return unexpectedShareFailure("update", error);
  }
}
