import { NextResponse } from "next/server";

import { isValidMonthKey, type MonthKey } from "@/src/domain/dates";
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

export const runtime = "nodejs";
// Every response depends on the session and on live data, so nothing here may be cached.
export const dynamic = "force-dynamic";

/**
 * Download the contract summary workbook for a month.
 *
 * The gate is re-checked here, not just in the UI that hides the button: R4.3 is the
 * product's core promise, and a promise enforced only in the browser is not enforced.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Not signed in", { status: 401 });

  // Generating an artifact writes to storage and records a permanent, pinned row, so it
  // must not be reachable by a cross-site navigation. The session cookie is SameSite=Lax,
  // which rides top-level navigations, and this route is a GET — so a third-party page
  // could otherwise force generation in the victim's organisation.
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

  // Re-checked here (with the documentation gate, R4.3), not just in the packet screen's
  // dialog — see `prepareMonthOutput`. A promise enforced only in the browser is not enforced.
  const prepared = await prepareMonthOutput({
    orgId: session.orgId,
    source,
    month: month as MonthKey,
    kind: "summary",
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
    // The refusals above are deliberate and worded; this is a genuine fault. The detail is
    // logged rather than sent to the browser.
    console.error("summary workbook generation failed", {
      orgId: session.orgId,
      month,
      error,
    });
    return new NextResponse(monthOutputFailureMessage("summary", error), {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": attachmentHeader(prepared.filename),
      // A pinned artifact is immutable, but the URL is not: it serves whatever the current
      // data hashes to, so a shared cache must never answer for it.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
