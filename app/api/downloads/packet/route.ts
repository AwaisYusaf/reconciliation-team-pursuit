import { NextResponse } from "next/server";

import { isValidMonthKey, type MonthKey } from "@/src/domain/dates";
import { PacketError } from "@/src/generation/packet-pdf";
import { attachmentHeader } from "@/src/lib/http";
import { findFundingSource } from "@/src/modules/funding-sources/queries";
import {
  generationBudgetMessage,
  monthOutputFailureMessage,
  prepareMonthOutput,
  resolveMonthOutput,
} from "@/src/modules/packet/month-output";
import { getSession } from "@/src/services/auth/session";
import { consume } from "@/src/services/rate-limit";
import { SESSION_EXPIRED } from "@/src/lib/action-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Assembling a few hundred rasterised pages takes far longer than a normal request. */
export const maxDuration = 600;

/**
 * Download the month-end packet.
 *
 * A partial packet is never served: any failure returns an error naming the section or file
 * that failed, and nothing is written to the artifact cache.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse(SESSION_EXPIRED, { status: 401 });

  // Absent header falls through on purpose: every browser since Safari 16.4 sends it, and
  // SameSite=Lax plus the same-origin policy already cover the realistic cases — so a
  // missing header means an old client or a non-browser caller, not an attack to block.
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") {
    return new NextResponse("Cross-site downloads are not allowed", { status: 403 });
  }

  // Declared in the architecture and never enforced until now. Generation rasterises
  // hundreds of pages and can run for minutes, so one authenticated tab could otherwise
  // queue unbounded work on the single container that also hosts Postgres.
  const budget = consume("generate", session.orgId);
  if (!budget.allowed) {
    const seconds = budget.retryAfterSeconds;
    return new NextResponse(
      generationBudgetMessage(seconds),
      { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(seconds) } },
    );
  }

  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? "";
  if (!isValidMonthKey(month)) return new NextResponse("Unknown month", { status: 400 });

  // The `source` query parameter is required and verified server-side; a missing, malformed or
  // foreign id is the same 404, so a probe learns nothing.
  const source = await findFundingSource(session.orgId, url.searchParams.get("source") ?? "");
  if (!source) return new NextResponse("Unknown funding source", { status: 404 });

  // The packet screen's dialog is the only place this confirmation is asked for — re-checked
  // (with the documentation gate, R4.3) in `prepareMonthOutput`, so a direct hit on this URL
  // cannot skip the review a UI-only gate would only pretend to enforce.
  const prepared = await prepareMonthOutput({
    orgId: session.orgId,
    source,
    month: month as MonthKey,
    kind: "packet",
    confirmedDeletions: url.searchParams.get("confirmedDeletions") === "1",
  });
  if (!prepared.ok) {
    return new NextResponse(prepared.message, {
      status: prepared.status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let body: Buffer;
  let contentType: string;

  try {
    ({ body, contentType } = await resolveMonthOutput(prepared));
  } catch (error) {
    const at = error instanceof PacketError ? error.at : null;
    console.error("packet generation failed", { orgId: session.orgId, month, at, error });
    return new NextResponse(monthOutputFailureMessage("packet", error), {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": attachmentHeader(prepared.filename),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
