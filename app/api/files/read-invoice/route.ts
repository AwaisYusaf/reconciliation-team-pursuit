import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/src/db";
import { aiUsageEvents } from "@/src/db/schema";
import { UI } from "@/src/domain/strings";
import { sameOrigin } from "@/src/lib/same-origin";
import { readAmountsAllowedForOrg } from "@/src/modules/ai/access";
import { beginRead, endRead } from "@/src/modules/amount-reading/in-flight";
import { MAX_PAGES_READ } from "@/src/modules/amount-reading/page-cap";
import { consume } from "@/src/services/rate-limit";
import { getSession } from "@/src/services/auth/session";
import { readInvoice } from "@/src/services/openai/read-invoice";
import { costMicroUsd } from "@/src/services/openai/responses";
import { inspectUpload } from "@/src/services/storage/inspect";
import { MAX_UPLOAD_BYTES } from "@/src/services/storage/keys";
import { SESSION_EXPIRED } from "@/src/lib/action-result";

export const runtime = "nodejs";

/**
 * Read vendor, date and charge lines from one uploaded invoice PDF (Phase 14 §2).
 *
 * Same shape as `read-amounts/route.ts`: session, same-origin, the plan/switch access check, a
 * per-org rate limit (a tighter one — an invoice read costs far more, see `rate-limit.ts`), a
 * size cap before `formData()` buffers the body, and an in-flight slot. Only a freshly-picked
 * file is accepted — there is no "already-attached document" input here, because a draft import
 * is always a brand-new upload. Exactly one `ai_usage_events` row is written per request that
 * reaches the read, whatever the outcome, unconditionally from that point on.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: SESSION_EXPIRED }, { status: 401 });
  }

  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Bad origin." }, { status: 403 });
  }

  if (!(await readAmountsAllowedForOrg(session.orgId))) {
    return NextResponse.json({ ok: false, error: "This feature is not available." }, { status: 403 });
  }

  const limit = consume("readInvoice", session.orgId);
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

  // A slot per concurrent read, taken before the body is buffered (PR #18 review, mirrored here).
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

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Choose a file." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: "That file is larger than 25 MB." }, { status: 400 });
    }

    const inspection = await inspectUpload({
      body: Buffer.from(await file.arrayBuffer()),
      declaredMimeType: file.type,
    });
    if (!inspection.ok) {
      // A refused file still gets logged, as a failed read — nothing was ever stored.
      await logFailure(session.orgId, session.userId);
      return NextResponse.json({ ok: false, error: inspection.error }, { status: 400 });
    }
    // This route reads invoices only — refuse anything the inspected bytes say isn't a PDF, not
    // just whatever the browser declared (Phase 14 §2).
    if (inspection.mimeType !== "application/pdf") {
      await logFailure(session.orgId, session.userId);
      return NextResponse.json({ ok: false, error: "Invoices must be uploaded as a PDF." }, { status: 400 });
    }
    if (inspection.pageCount > MAX_PAGES_READ) {
      await logFailure(session.orgId, session.userId);
      return NextResponse.json(
        {
          ok: false,
          error: UI.readInvoiceTooManyPages(inspection.pageCount, MAX_PAGES_READ),
          code: "too-long",
        },
        { status: 400 },
      );
    }

    const result = await readInvoice({ body: inspection.body, mimeType: inspection.mimeType });

    await db.insert(aiUsageEvents).values({
      orgId: session.orgId,
      userId: session.userId,
      feature: "invoice_read",
      documentSource: "upload",
      documentKind: "receipt",
      outcome: result.outcome,
      model: process.env.OPENAI_READ_MODEL ?? "",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costMicroUsd: costMicroUsd(result.inputTokens, result.outputTokens),
    });

    if (result.outcome === "failed") {
      return NextResponse.json({ ok: false, error: "That document could not be read." }, { status: 502 });
    }
    if (result.outcome === "none") {
      return NextResponse.json({ ok: true, data: { found: false, error: UI.readInvoiceNothingFound } });
    }
    return NextResponse.json({
      ok: true,
      data: {
        found: true,
        invoice: result.invoice,
        truncated: result.truncated,
        ...(result.truncated ? { truncatedMessage: UI.readInvoiceTooManyLines } : {}),
      },
    });
  } catch (error) {
    console.error("read-invoice failed", { orgId: session.orgId });
    void error;
    return NextResponse.json(
      { ok: false, error: "That document could not be read. Try again." },
      { status: 500 },
    );
  } finally {
    endRead(session.orgId);
  }
}

async function logFailure(orgId: string, userId: string): Promise<void> {
  await db.insert(aiUsageEvents).values({
    orgId,
    userId,
    feature: "invoice_read",
    documentSource: "upload",
    documentKind: "receipt",
    outcome: "failed",
    model: process.env.OPENAI_READ_MODEL ?? "",
  });
}
