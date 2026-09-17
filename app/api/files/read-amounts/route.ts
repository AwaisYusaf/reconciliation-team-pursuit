import { and, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/src/db";
import { aiUsageEvents, expenseDocuments, expenses, type AiUsageDocumentKind } from "@/src/db/schema";
import { isUuid } from "@/src/lib/ids";
import { sameOrigin } from "@/src/lib/same-origin";
import { readAmountsAllowedForOrg } from "@/src/modules/amount-reading/access";
import { consume } from "@/src/services/rate-limit";
import { getSession } from "@/src/services/auth/session";
import { costMicroUsd, readAmounts } from "@/src/services/openai/read-amounts";
import { inspectUpload } from "@/src/services/storage/inspect";
import { storage } from "@/src/services/storage/driver";
import { MAX_UPLOAD_BYTES } from "@/src/services/storage/keys";

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
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "That upload was malformed." }, { status: 400 });
  }

  try {
    const resolved = await resolveInput(session.orgId, session.userId, form);
    if (!resolved.ok) return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });

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
    if (result.outcome === "none") {
      return NextResponse.json({ ok: true, data: { found: false } });
    }
    return NextResponse.json({
      ok: true,
      data: {
        found: true,
        subtotalCents: result.amounts.subtotalCents,
        taxCents: result.amounts.taxCents,
        feesCents: result.amounts.feesCents,
        totalCents: result.amounts.totalCents,
      },
    });
  } catch (error) {
    console.error("read-amounts failed", { orgId: session.orgId });
    void error;
    return NextResponse.json(
      { ok: false, error: "That document could not be read. Try again." },
      { status: 500 },
    );
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
  | { ok: false; status: number; error: string };

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
      mimeType: expenseDocuments.mimeType,
      kind: expenseDocuments.kind,
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
  if (row.kind !== "receipt" && row.kind !== "proof") {
    return { ok: false, status: 400, error: "That document type is not read." };
  }

  try {
    const body = await storage().get(row.s3Key);
    return { ok: true, body, mimeType: row.mimeType, kind: row.kind, source: "attached" };
  } catch {
    await logFailure(orgId, userId, "attached", row.kind);
    return { ok: false, status: 502, error: "That document could not be read." };
  }
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
