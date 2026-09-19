import { NextResponse, type NextRequest } from "next/server";

import { isValidMonthKey } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { sameOrigin } from "@/src/lib/same-origin";
import { consume } from "@/src/services/rate-limit";
import { getSession } from "@/src/services/auth/session";
import { findFundingSource } from "@/src/modules/funding-sources/queries";
import { lockMonth } from "@/src/modules/packet/lock";
import { ingestExpenseDocument, ingestMonthDocument } from "@/src/services/storage/documents";
import { MAX_UPLOAD_BYTES, type DocumentScope } from "@/src/services/storage/keys";
import type { MonthDocumentCategory } from "@/src/db/schema";
import { SESSION_EXPIRED } from "@/src/lib/action-result";

export const runtime = "nodejs";

const EXPENSE_SCOPES: DocumentScope[] = ["proof", "receipt", "supporting"];
const MONTH_CATEGORIES: MonthDocumentCategory[] = [
  "bank_statement",
  "combined_hours",
  "timesheet",
  "fiduciary_invoice",
  "other",
];

/**
 * Upload endpoint (D-30).
 *
 * Authenticates independently of `proxy.ts`, verifies the request's origin because it is a
 * cookie-authenticated mutation outside a Server Action, and hands the bytes to the
 * ingestion service, which proves and normalises them before anything is recorded.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: SESSION_EXPIRED }, { status: 401 });
  }

  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "This upload couldn't be verified. Reload the page and try again." }, { status: 403 });
  }

  const limit = consume("presign", session.orgId);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many uploads at once. Wait a minute, then try again." },
      { status: 429 },
    );
  }

  // Reject oversized bodies before formData() buffers them into memory. Next applies its
  // body size limit to Server Actions only, never to route handlers.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_UPLOAD_BYTES + 1_000_000) {
    return NextResponse.json(
      { ok: false, error: "That file is larger than the 25 MB limit. Upload a smaller copy, for example a lower-resolution scan." },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "That file didn't upload completely. Try again." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file arrived. Choose the file and try again." }, { status: 400 });
  }

  const target = String(form.get("target") ?? "expense");

  try {
  if (target === "month") {
    const category = String(form.get("category") ?? "") as MonthDocumentCategory;
    if (!MONTH_CATEGORIES.includes(category)) {
      return NextResponse.json({ ok: false, error: "Choose a category." }, { status: 400 });
    }
    const month = String(form.get("month") ?? session.activeMonth);
    if (!isValidMonthKey(month)) {
      return NextResponse.json({ ok: false, error: "That is not a valid month." }, { status: 400 });
    }
    const fundingSourceId = String(form.get("fundingSourceId") ?? "");
    const source = await findFundingSource(session.orgId, fundingSourceId);
    if (!source) {
      return NextResponse.json({ ok: false, error: "Choose a funding source." }, { status: 400 });
    }
    // Review fix: an archived source refuses new records everywhere else (line items,
    // expenses) — month documents were the one create path that slipped through.
    if (source.archivedAt) {
      return NextResponse.json(
        { ok: false, error: "That funding source is archived. Unarchive it in Settings to add documents." },
        { status: 400 },
      );
    }
    const result = await ingestMonthDocument({
      orgId: session.orgId,
      fundingSourceId,
      month,
      category,
      title: form.get("title") ? String(form.get("title")) : null,
      file,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (target === "signed-packet") {
    const month = String(form.get("month") ?? "");
    if (!isValidMonthKey(month)) {
      return NextResponse.json({ ok: false, error: "That is not a valid month." }, { status: 400 });
    }
    const fundingSourceId = String(form.get("fundingSourceId") ?? "");
    const source = await findFundingSource(session.orgId, fundingSourceId);
    if (!source) {
      return NextResponse.json({ ok: false, error: "Choose a funding source." }, { status: 400 });
    }
    // Archived sources are allowed to lock their last months (plan §7 Q3, R14.3) — unlike
    // `target=month` above, no archived refusal here.
    const result = await lockMonth({
      orgId: session.orgId,
      userId: session.userId,
      fundingSourceId,
      month,
      file,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  const scope = String(form.get("scope") ?? "") as DocumentScope;
  if (!EXPENSE_SCOPES.includes(scope)) {
    return NextResponse.json({ ok: false, error: "Unknown document kind." }, { status: 400 });
  }

  const result = await ingestExpenseDocument({
    orgId: session.orgId,
    expenseId: String(form.get("expenseId") ?? ""),
    scope,
    supportingType: form.get("supportingType") ? String(form.get("supportingType")) : null,
    file,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    // A storage or database failure must still answer with JSON: the client parses the
    // body, and a non-JSON 500 would reject inside a transition and replace the user's
    // half-filled form with the error screen.
    console.error("upload failed", { orgId: session.orgId });
    void error;
    return NextResponse.json(
      {
        ok: false,
        error: `That file couldn't be saved. Try again, and if it keeps failing, contact support at ${UI.supportEmail}.`,
      },
      { status: 500 },
    );
  }
}
