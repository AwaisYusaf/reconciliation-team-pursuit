import { NextResponse, type NextRequest } from "next/server";

import { consume } from "@/src/services/rate-limit";
import { getSession } from "@/src/services/auth/session";
import { ingestExpenseDocument, ingestMonthDocument } from "@/src/services/storage/documents";
import type { DocumentScope } from "@/src/services/storage/keys";
import type { MonthDocumentCategory } from "@/src/db/schema";

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
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Bad origin." }, { status: 403 });
  }

  const limit = consume("presign", session.orgId);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many uploads at once. Try again shortly." },
      { status: 429 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "That upload was malformed." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file was received." }, { status: 400 });
  }

  const target = String(form.get("target") ?? "expense");

  if (target === "month") {
    const category = String(form.get("category") ?? "") as MonthDocumentCategory;
    if (!MONTH_CATEGORIES.includes(category)) {
      return NextResponse.json({ ok: false, error: "Choose a category." }, { status: 400 });
    }
    const month = String(form.get("month") ?? session.activeMonth);
    const result = await ingestMonthDocument({
      orgId: session.orgId,
      month,
      category,
      title: form.get("title") ? String(form.get("title")) : null,
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
}

/**
 * Origin check for a cookie-authenticated mutation. Server Actions get this from Next.js;
 * route handlers have to do it themselves (architecture §Auth).
 */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}
