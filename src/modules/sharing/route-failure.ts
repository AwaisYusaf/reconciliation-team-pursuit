import "server-only";

import { NextResponse } from "next/server";

import { UI } from "@/src/domain/strings";
import { fail } from "@/src/lib/action-result";

/**
 * A fault the share actions didn't word themselves (a database error, say), answered in the same
 * JSON shape as every other result. Next's own 500 is an HTML page, which the screen could only
 * report as a lost connection — after the user had waited out a packet build (PHASE-12 review).
 */
export function unexpectedShareFailure(what: "create" | "update", error: unknown): NextResponse {
  console.error(`shared link ${what} failed`, { error });
  return NextResponse.json(fail(UI.shareUnexpected), { status: 500 });
}
