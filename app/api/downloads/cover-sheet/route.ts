import { NextResponse } from "next/server";

import { coverSheetRows } from "@/src/domain/cover-sheet";
import { isValidMonthKey, monthLabel, type MonthKey } from "@/src/domain/dates";
import { blockingRecords } from "@/src/domain/gate";
import { coverSheetFilename, coverSheetTitle } from "@/src/domain/strings";
import { resolveArtifact } from "@/src/generation/artifacts";
import { inputsHash } from "@/src/generation/cache-key";
import { buildCoverSheetDocx } from "@/src/generation/cover-sheet-docx";
import { loadProofImages } from "@/src/generation/cover-sheet-images";
import { convertDocxToPdf } from "@/src/generation/docx-to-pdf";
import {
  expensesForLineItem,
  gateExpenses,
  loadMonthSnapshot,
} from "@/src/generation/month-snapshot";
import { attachmentHeader } from "@/src/lib/http";
import { isUuid } from "@/src/lib/ids";
import { getSession } from "@/src/services/auth/session";
import { consume } from "@/src/services/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bump when the sheet's layout changes, so cached artifacts rebuild (R10.4). */
// Bumped "cover-4": the exclusion note now names what was actually excluded (D-67). Without this, pinned and cached
// artifacts would keep serving output built before the change.
const GENERATOR_VERSION = "cover-4";

/**
 * Download one line item's cover sheet, as .docx or .pdf.
 *
 * The docx is canonical and the PDF is converted from it, so the two formats are the same
 * document rather than two renderings that might disagree.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Not signed in", { status: 401 });

  // Generation writes storage and pins a permanent row, so it must not be reachable by a
  // cross-site navigation carrying the SameSite=Lax session cookie.
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

  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  const lineItemId = params.get("lineItem") ?? "";
  const format = params.get("format") === "pdf" ? "pdf" : "docx";

  if (!isValidMonthKey(month)) return new NextResponse("Unknown month", { status: 400 });
  // A malformed id would raise a Postgres cast error out of an unguarded handler.
  if (!isUuid(lineItemId)) return new NextResponse("Not found", { status: 404 });

  const snapshot = await loadMonthSnapshot(session.orgId, month as MonthKey);
  const lineItem = snapshot.lineItems.find((item) => item.id === lineItemId);
  // Indistinguishable from "belongs to another organisation", so a probe learns nothing.
  if (!lineItem) return new NextResponse("Not found", { status: 404 });

  const expenses = expensesForLineItem(snapshot, lineItemId);
  if (expenses.length === 0) {
    return new NextResponse(
      `No expenses recorded for ${monthLabel(month as MonthKey)} in ${lineItem.name} yet.`,
      { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  // Only this line item's own records gate it — another line item's gap must not hold this
  // one hostage (R4.3).
  const blocking = blockingRecords(gateExpenses(expenses));
  if (blocking.length > 0) {
    return new NextResponse(
      `${blocking.length} ${blocking.length === 1 ? "record is" : "records are"} missing documentation:\n` +
        blocking.map((record) => `• ${record.label}`).join("\n"),
      { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const label = monthLabel(month as MonthKey);
  const title = coverSheetTitle(snapshot.docName, label, lineItem.name);

  let body: Buffer;
  let contentType: string;
  try {
    ({ body, contentType } = await resolveArtifact({
      orgId: session.orgId,
      month: month as MonthKey,
      type: format === "pdf" ? "cover_pdf" : "cover_docx",
      lineItemId,
      lineItemName: lineItem.name,
      extension: format,
      hash: inputsHash({
        snapshot,
        generatorVersion: GENERATOR_VERSION,
        // The two formats are the same document, so they must not share a cache entry.
        scope: `${lineItemId}:${format}`,
      }),
      build: async () => {
        const composed = coverSheetRows(expenses);
        const docx = await buildCoverSheetDocx({
          title,
          rows: composed.rows,
          totalCents: composed.totalCents,
          images: await loadProofImages(session.orgId, expenses),
        });
        return format === "pdf" ? convertDocxToPdf(docx) : docx;
      },
    }));
  } catch (error) {
    console.error("cover sheet generation failed", {
      orgId: session.orgId,
      month,
      lineItemId,
      format,
      error,
    });
    return new NextResponse(
      `The ${lineItem.name} cover sheet could not be generated just now. Please try again — if it keeps failing, contact Mantaq.`,
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": attachmentHeader(
        coverSheetFilename(snapshot.docName, label, lineItem.name, format),
      ),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
