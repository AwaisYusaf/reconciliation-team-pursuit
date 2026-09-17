import { NextResponse } from "next/server";

import { isValidMonthKey, monthLabel, type MonthKey } from "@/src/domain/dates";
import { monthlySummaryFilename, monthlySummaryTitle, UI } from "@/src/domain/strings";
import { convertDocxToPdf } from "@/src/generation/docx-to-pdf";
import { buildMonthlySummaryDocx } from "@/src/generation/monthly-summary-docx";
import { attachmentHeader } from "@/src/lib/http";
import { findFundingSource, loadSourceContext } from "@/src/modules/funding-sources/queries";
import { summariesAccessForOrg } from "@/src/modules/ai/access";
import { loadSummaryForDownload } from "@/src/modules/monthly-summary/queries";
import { getSession } from "@/src/services/auth/session";
import { consume } from "@/src/services/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download a saved monthly summary as Word or PDF (Phase 11 §6, §7.4, P13).
 *
 * Builds from the saved `content_markdown` only — never from whatever the screen currently
 * shows — so a download always matches what a reload would show. No `monthLocked`/archived
 * check (P8/P9): summaries work regardless, same as the rest of this feature.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Not signed in", { status: 401 });

  // Same reasoning as the cover sheet download (`app/api/downloads/cover-sheet/route.ts`):
  // generation must not be reachable by a cross-site navigation carrying the session cookie.
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") {
    return new NextResponse("Cross-site downloads are not allowed", { status: 403 });
  }

  const budget = consume("generate", session.orgId);
  if (!budget.allowed) {
    const seconds = budget.retryAfterSeconds;
    return new NextResponse(
      `Too many documents requested at once. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
      { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(seconds) } },
    );
  }

  const access = await summariesAccessForOrg(session.orgId);
  if (!access.use) {
    return new NextResponse(UI.summaryPlanNote, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  if (!isValidMonthKey(month)) return new NextResponse("Unknown month", { status: 400 });

  const formatParam = params.get("format");
  const format = formatParam === "docx" || formatParam === "pdf" ? formatParam : null;
  if (!format) return new NextResponse("Unknown format", { status: 400 });

  // The `source` query parameter is verified server-side; a missing, malformed or foreign id is
  // the same 404, so a probe learns nothing.
  const source = await findFundingSource(session.orgId, params.get("source") ?? "");
  if (!source) return new NextResponse("Unknown funding source", { status: 404 });

  const loaded = await loadSummaryForDownload(session.orgId, source.id, month as MonthKey);
  if (!loaded) return new NextResponse("No summary for this month", { status: 404 });

  // Filenames and the title gain the source name only once the organisation has more than one
  // source (R10.3, P13).
  const { single } = await loadSourceContext(session.orgId, session.activeFundingSourceId);
  const label = monthLabel(month as MonthKey);
  const sourceName = single ? undefined : loaded.sourceName;

  let docx: Buffer;
  try {
    docx = await buildMonthlySummaryDocx({
      title: monthlySummaryTitle(loaded.docName, label, sourceName),
      markdown: loaded.contentMarkdown,
    });
  } catch (error) {
    console.error("monthly summary docx build failed", { orgId: session.orgId, sourceId: source.id, month, error });
    return new NextResponse("The summary couldn't be prepared right now. Please try again.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let body: Buffer;
  let contentType: string;
  if (format === "pdf") {
    try {
      body = await convertDocxToPdf(docx);
    } catch (error) {
      // Ids and the converter's error only — never the summary text.
      console.error("monthly summary PDF conversion failed", { orgId: session.orgId, sourceId: source.id, month, error });
      return new NextResponse(UI.summaryPdfFailed, {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    contentType = "application/pdf";
  } else {
    body = docx;
    contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": attachmentHeader(monthlySummaryFilename(loaded.docName, label, format, sourceName)),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
