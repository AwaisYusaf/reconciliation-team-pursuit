import { NextResponse } from "next/server";

import { isValidMonthKey, type MonthKey } from "@/src/domain/dates";
import { blockingRecords } from "@/src/domain/gate";
import { resolveArtifact } from "@/src/generation/artifacts";
import { inputsHash } from "@/src/generation/cache-key";
import { gateExpenses, loadMonthSnapshot } from "@/src/generation/month-snapshot";
import { buildSummaryWorkbook, summaryWorkbookName } from "@/src/generation/summary-xlsx";
import { attachmentHeader } from "@/src/lib/http";
import { deletedItemsRefusal, loadTrashedExpenses } from "@/src/modules/expenses/queries";
import { findFundingSource, loadSourceContext } from "@/src/modules/funding-sources/queries";
import { getSession } from "@/src/services/auth/session";
import { consume } from "@/src/services/rate-limit";

export const runtime = "nodejs";
// Every response depends on the session and on live data, so nothing here may be cached.
export const dynamic = "force-dynamic";

/** Bump when the workbook's layout changes, so cached artifacts rebuild (R10.4). */
// Bumped "summary-3": the detail sheet gained a Receipt Total column (R1.3a). Without this, pinned and cached
// artifacts would keep serving output built before the change.
const GENERATOR_VERSION = "summary-3";

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
      `Too many documents requested at once. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
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
  const fundingSourceId = source.id;

  // Re-checked here, not just in the packet screen's dialog — see the packet route's own
  // comment on this same gate. A promise enforced only in the browser is not enforced.
  const confirmedDeletions = url.searchParams.get("confirmedDeletions") === "1";
  const deletedThisMonth = await loadTrashedExpenses(session.orgId, fundingSourceId, month);
  if (deletedThisMonth.length > 0 && !confirmedDeletions) {
    return new NextResponse(deletedItemsRefusal(deletedThisMonth), {
      status: 409,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const snapshot = await loadMonthSnapshot(session.orgId, fundingSourceId, month as MonthKey);

  // Filenames gain the source name only once the organisation has more than one source (R10.3).
  const { single } = await loadSourceContext(session.orgId, session.activeFundingSourceId);

  const blocking = blockingRecords(gateExpenses(snapshot.expenses));
  if (blocking.length > 0) {
    return new NextResponse(
      `${blocking.length} ${blocking.length === 1 ? "record is" : "records are"} missing documentation:\n` +
        blocking.map((record) => `• ${record.label}`).join("\n"),
      { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  let body: Buffer;
  let contentType: string;
  try {
    ({ body, contentType } = await resolveArtifact({
      orgId: session.orgId,
      fundingSourceId,
      month: month as MonthKey,
      type: "summary_xlsx",
      extension: "xlsx",
      hash: inputsHash({ snapshot, generatorVersion: GENERATOR_VERSION }),
      build: () => buildSummaryWorkbook(snapshot),
    }));
  } catch (error) {
    // The refusals above are deliberate and worded; this is a genuine fault. The client
    // shows whatever text comes back, so it gets something actionable rather than Next's
    // generic 500 page, and the detail is logged rather than sent to the browser.
    console.error("summary workbook generation failed", {
      orgId: session.orgId,
      month,
      error,
    });
    return new NextResponse(
      "The summary could not be generated just now. Please try again — if it keeps failing, contact Mantaq.",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": attachmentHeader(
        summaryWorkbookName(snapshot.docName, month as MonthKey, single ? undefined : source.name),
      ),
      // A pinned artifact is immutable, but the URL is not: it serves whatever the current
      // data hashes to, so a shared cache must never answer for it.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
