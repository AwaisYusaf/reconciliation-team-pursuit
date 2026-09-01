import { NextResponse } from "next/server";

import { isValidMonthKey, monthLabel, type MonthKey } from "@/src/domain/dates";
import { blockingRecords } from "@/src/domain/gate";
import { packetFilename } from "@/src/domain/strings";
import { resolveArtifact } from "@/src/generation/artifacts";
import { inputsHash } from "@/src/generation/cache-key";
import { gateExpenses, loadMonthSnapshot } from "@/src/generation/month-snapshot";
import { buildDeliverablePacket } from "@/src/generation/packet-build";
import { MAX_PACKET_BYTES, oversizeWarning } from "@/src/generation/packet-footer";
import { PacketError } from "@/src/generation/packet-pdf";
import { attachmentHeader } from "@/src/lib/http";
import { getSession } from "@/src/services/auth/session";
import { consume } from "@/src/services/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Assembling a few hundred rasterised pages takes far longer than a normal request. */
export const maxDuration = 600;

/** Bump when the packet's layout or ordering changes, so cached artifacts rebuild (R10.4). */
// Bumped "packet-6": the expense index now discloses undocumented expenses (D-74).
// Without a bump, pinned and cached artifacts keep serving output built before the change.
const GENERATOR_VERSION = "packet-7";

/**
 * Download the month-end packet.
 *
 * A partial packet is never served: any failure returns an error naming the section or file
 * that failed, and nothing is written to the artifact cache.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Not signed in", { status: 401 });

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

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!isValidMonthKey(month)) return new NextResponse("Unknown month", { status: 400 });

  const snapshot = await loadMonthSnapshot(session.orgId, month as MonthKey);
  const label = monthLabel(month as MonthKey);

  // A month with no expenses is downloadable — summary and month documents only — so the
  // organisation can still submit a period in which nothing was spent.
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
      month: month as MonthKey,
      type: "packet_pdf",
      extension: "pdf",
      hash: inputsHash({ snapshot, generatorVersion: GENERATOR_VERSION }),
      build: async () => (await buildDeliverablePacket(snapshot)).pdf,
    }));
  } catch (error) {
    // PacketError names the section or file that failed, which is what the screen shows.
    const at = error instanceof PacketError ? error.at : null;
    console.error("packet generation failed", { orgId: session.orgId, month, at, error });
    return new NextResponse(
      at
        ? `Packet generation failed at ${at}. Please try again — if it keeps failing, contact Mantaq.`
        : "The packet could not be generated just now. Please try again — if it keeps failing, contact Mantaq.",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  // Derived from the bytes actually being sent rather than from the build, so a packet
  // served from the cache carries the same warning the build would have produced.
  //
  // Percent-encoded because header values are ByteStrings: the warning contains an em dash
  // and a curly apostrophe, and passing either raw makes constructing the Response throw —
  // which would turn "deliver anyway" into the one path that can never deliver.
  const warning = body.byteLength > MAX_PACKET_BYTES ? oversizeWarning(body.byteLength) : null;

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": attachmentHeader(packetFilename(snapshot.docName, label)),
      // Surfaced by the client as a warning toast; the download still succeeds.
      ...(warning ? { "X-Packet-Warning": encodeURIComponent(warning) } : {}),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
