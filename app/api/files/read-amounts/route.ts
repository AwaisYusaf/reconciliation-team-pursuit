import { and, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/src/db";
import {
  aiUsageEvents,
  expenseDocuments,
  expenses,
  vendorDefaults,
  type AiUsageDocumentKind,
} from "@/src/db/schema";
import type { ReceiptDetails } from "@/src/domain/amount-suggestion";
import { UI } from "@/src/domain/strings";
import { matchLibraryVendor } from "@/src/domain/vendor-match";
import { isUuid } from "@/src/lib/ids";
import { sameOrigin } from "@/src/lib/same-origin";
import { readAmountsAllowedForOrg } from "@/src/modules/ai/access";
import { isImportedInvoice } from "@/src/modules/expenses/queries";
import { beginRead, endRead } from "@/src/modules/amount-reading/in-flight";
import { MAX_PAGES_READ } from "@/src/modules/amount-reading/page-cap";
import { consume } from "@/src/services/rate-limit";
import { routeSession } from "@/src/lib/route-session";
import { readAmounts } from "@/src/services/openai/read-amounts";
import { costMicroUsd } from "@/src/services/openai/responses";
import { inspectUpload } from "@/src/services/storage/inspect";
import { storage } from "@/src/services/storage/driver";
import { MAX_UPLOAD_BYTES } from "@/src/services/storage/keys";
import { SESSION_EXPIRED } from "@/src/lib/action-result";

export const runtime = "nodejs";

const READABLE_KINDS: AiUsageDocumentKind[] = ["receipt", "proof"];

/**
 * Read Subtotal/Tax/Fees/Total from one receipt or proof of payment (Phase 10, D-105, §3.4).
 *
 * Same shape as `app/api/files/upload/route.ts`: session, same-origin, a size cap before
 * `formData()` buffers the body, a per-org rate limit, then the single access check. Two
 * inputs — a freshly-picked file that is never stored, or the id of a document already
 * attached to an expense in this organisation. Exactly one `ai_usage_events` row is written per
 * request that reaches a resolved document, whatever the outcome — the log is unconditional
 * from that point on, so usage can't be undercounted by an early return.
 */
export async function POST(request: NextRequest) {
  const session = await routeSession("json");
  if (!session) {
    return NextResponse.json({ ok: false, error: SESSION_EXPIRED }, { status: 401 });
  }
  if ("denied" in session) return session.denied;

  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Bad origin." }, { status: 403 });
  }

  if (!(await readAmountsAllowedForOrg(session.orgId))) {
    return NextResponse.json({ ok: false, error: "This feature is not available." }, { status: 403 });
  }

  const limit = consume("readAmounts", session.orgId);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many reads at once. Try again shortly." },
      { status: 429 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_UPLOAD_BYTES + 1_000_000) {
    return NextResponse.json(
      { ok: false, error: "That file is larger than 25 MB." },
      { status: 413 },
    );
  }

  // A slot per concurrent read, taken before the body is buffered — that is the memory this
  // guard exists to bound (PR #18 review).
  if (!beginRead(session.orgId)) {
    return NextResponse.json(
      { ok: false, error: "Too many reads at once. Try again shortly." },
      { status: 429 },
    );
  }

  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ ok: false, error: "That upload was malformed." }, { status: 400 });
    }

    const resolved = await resolveInput(session.orgId, session.userId, form);
    if (!resolved.ok) {
      return NextResponse.json(
        { ok: false, error: resolved.error, ...(resolved.code ? { code: resolved.code } : {}) },
        { status: resolved.status },
      );
    }

    const { body, mimeType, kind, source } = resolved;
    const result = await readAmounts({ body, mimeType, kind });

    await db.insert(aiUsageEvents).values({
      orgId: session.orgId,
      userId: session.userId,
      feature: "amount_read",
      documentSource: source,
      documentKind: kind,
      outcome: result.outcome,
      model: process.env.OPENAI_READ_MODEL ?? "",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costMicroUsd: costMicroUsd(result.inputTokens, result.outputTokens),
    });

    if (result.outcome === "failed") {
      return NextResponse.json({ ok: false, error: "That document could not be read." }, { status: 502 });
    }
    // A receipt's vendor and date (Phase 19), after the usage row so the log never depends on
    // them. Absent keys, not nulls, when nothing was read: that response is Phase 10's exactly.
    const details = result.details ? await detailFields(session.orgId, result.details) : {};
    if (result.outcome === "none") {
      return NextResponse.json({ ok: true, data: { found: false, ...details } });
    }
    return NextResponse.json({
      ok: true,
      data: {
        found: true,
        subtotalCents: result.amounts.subtotalCents,
        taxCents: result.amounts.taxCents,
        feesCents: result.amounts.feesCents,
        totalCents: result.amounts.totalCents,
        ...details,
      },
    });
  } catch (error) {
    console.error("read-amounts failed", { orgId: session.orgId });
    void error;
    return NextResponse.json(
      { ok: false, error: "That document could not be read. Try again." },
      { status: 500 },
    );
  } finally {
    endRead(session.orgId);
  }
}

type Resolved =
  | {
      ok: true;
      body: Buffer;
      mimeType: string;
      kind: AiUsageDocumentKind;
      source: "upload" | "attached";
    }
  | { ok: false; status: number; error: string; code?: "too-long" };

async function resolveInput(orgId: string, userId: string, form: FormData): Promise<Resolved> {
  const file = form.get("file");
  const documentId = form.get("documentId");
  const hasFile = file instanceof File;
  const hasDocumentId = typeof documentId === "string" && documentId.length > 0;

  if (hasFile === hasDocumentId) {
    // Neither given, or both — exactly one input is valid.
    return { ok: false, status: 400, error: "Choose a file or an attached document, not both." };
  }

  if (hasFile) {
    const kind = String(form.get("kind") ?? "");
    if (!READABLE_KINDS.includes(kind as AiUsageDocumentKind)) {
      return { ok: false, status: 400, error: "Unknown document kind." };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, status: 400, error: "That file is larger than 25 MB." };
    }
    const inspection = await inspectUpload({
      body: Buffer.from(await file.arrayBuffer()),
      declaredMimeType: file.type,
    });
    if (inspection.ok && inspection.pageCount > MAX_PAGES_READ) {
      await logFailure(orgId, userId, "upload", kind as AiUsageDocumentKind);
      return { ok: false, status: 400, error: tooManyPages(inspection.pageCount), code: "too-long" };
    }
    if (!inspection.ok) {
      // A refused file still gets logged, as a failed read — nothing was ever stored.
      await logFailure(orgId, userId, "upload", kind as AiUsageDocumentKind);
      return { ok: false, status: 400, error: inspection.error };
    }
    return {
      ok: true,
      body: inspection.body,
      mimeType: inspection.mimeType,
      kind: kind as AiUsageDocumentKind,
      source: "upload",
    };
  }

  if (!isUuid(documentId)) {
    return { ok: false, status: 404, error: "That document no longer exists." };
  }

  const [row] = await db
    .select({
      s3Key: expenseDocuments.s3Key,
      pageCount: expenseDocuments.pageCount,
      mimeType: expenseDocuments.mimeType,
      kind: expenseDocuments.kind,
      fromInvoice: isImportedInvoice(expenseDocuments),
    })
    .from(expenseDocuments)
    .innerJoin(expenses, eq(expenses.id, expenseDocuments.expenseId))
    .where(
      and(
        eq(expenseDocuments.id, documentId),
        eq(expenseDocuments.orgId, orgId),
        eq(expenses.orgId, orgId),
        isNull(expenses.deletedAt),
        eq(expenseDocuments.status, "attached"),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, status: 404, error: "That document no longer exists." };
  // An imported invoice is the whole bill, never one charge's receipt: its total and vendor would
  // be offered for this one charge. The form leaves it out too; this also covers a tab opened
  // before it did.
  if ((row.kind !== "receipt" && row.kind !== "proof") || row.fromInvoice) {
    return { ok: false, status: 400, error: "That document type is not read." };
  }
  // Same ceiling as a freshly-picked file. A row that predates page counting has `null`, which is
  // read as "one page" rather than refused: it was accepted before this cap existed.
  if ((row.pageCount ?? 1) > MAX_PAGES_READ) {
    await logFailure(orgId, userId, "attached", row.kind);
    return { ok: false, status: 400, error: tooManyPages(row.pageCount ?? 0), code: "too-long" };
  }

  try {
    const body = await storage().get(row.s3Key);
    return { ok: true, body, mimeType: row.mimeType, kind: row.kind, source: "attached" };
  } catch {
    await logFailure(orgId, userId, "attached", row.kind);
    return { ok: false, status: 502, error: "That document could not be read." };
  }
}

/**
 * What the form is offered from a receipt (Phase 19): the vendor in this organization's own
 * library spelling when it is a remembered business, as read otherwise, and the date.
 *
 * The library is read here, scoped to the session's organization, rather than matched in the
 * browser: one query per read, and no list of remembered names ever sent to the page for it. A
 * failed lookup only loses the library spelling; the read itself still answers.
 */
async function detailFields(
  orgId: string,
  details: ReceiptDetails,
): Promise<{ vendor?: string; date?: string }> {
  const fields: { vendor?: string; date?: string } = {};
  if (details.vendor) {
    let library: string[] = [];
    try {
      const rows = await db
        .select({ name: vendorDefaults.name })
        .from(vendorDefaults)
        .where(eq(vendorDefaults.orgId, orgId));
      library = rows.map((row) => row.name);
    } catch {
      console.error("read-amounts vendor library lookup failed", { orgId });
    }
    fields.vendor = matchLibraryVendor(details.vendor, library) ?? details.vendor;
  }
  if (details.date) fields.date = details.date;
  return fields;
}

function tooManyPages(pages: number): string {
  return UI.readAmountsTooManyPages(pages, MAX_PAGES_READ);
}

async function logFailure(
  orgId: string,
  userId: string,
  source: "upload" | "attached",
  kind: AiUsageDocumentKind,
): Promise<void> {
  await db.insert(aiUsageEvents).values({
    orgId,
    userId,
    feature: "amount_read",
    documentSource: source,
    documentKind: kind,
    outcome: "failed",
    model: process.env.OPENAI_READ_MODEL ?? "",
  });
}
