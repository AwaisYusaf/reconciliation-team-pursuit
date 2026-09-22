import { createHash } from "crypto";

import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { v7 as uuidv7 } from "uuid";

import { db } from "@/src/db";
import { expenseDrafts, expenseImports, lineItems } from "@/src/db/schema";
import { isValidIsoDate, monthLabel } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { parseMoneyToCents } from "@/src/domain/money";
import { SESSION_EXPIRED } from "@/src/lib/action-result";
import { sameOrigin } from "@/src/lib/same-origin";
import { isUuid } from "@/src/lib/ids";
import { readAmountsAllowedForOrg } from "@/src/modules/ai/access";
import { MAX_PAGES_READ } from "@/src/modules/amount-reading/page-cap";
import { findFundingSource } from "@/src/modules/funding-sources/queries";
import { monthLocked } from "@/src/modules/packet/month-guard";
import { isKnownPaymentSource } from "@/src/modules/settings/labels";
import { validate, type ValidateOptions } from "@/src/modules/expenses/validation";
import type { ExpenseInput } from "@/src/modules/expenses/actions";
import { MAX_INVOICE_LINES } from "@/src/services/openai/read-invoice";
import { consume } from "@/src/services/rate-limit";
import { getSession } from "@/src/services/auth/session";
import { storage } from "@/src/services/storage/driver";
import { deleteStoredObjects, orgStorageError, precheck } from "@/src/services/storage/documents";
import { inspectUpload } from "@/src/services/storage/inspect";
import { expenseImportKey, MAX_UPLOAD_BYTES } from "@/src/services/storage/keys";

export const runtime = "nodejs";

/** One ticked row as posted from the check screen — money still the on-screen strings, the
 *  amounts and the line item/payment source ownership are all re-verified below, never trusted
 *  from the client (Phase 14 §3, ticket §3). */
type PostedRow = {
  name: string;
  lineItemId: string;
  paymentSource: string;
  description: string;
  narrative: string;
  subtotal: string;
  tax: string;
  fees: string;
  date: string;
};

function isPostedRow(value: unknown): value is PostedRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.name === "string" &&
    typeof row.lineItemId === "string" &&
    typeof row.paymentSource === "string" &&
    typeof row.description === "string" &&
    typeof row.narrative === "string" &&
    typeof row.subtotal === "string" &&
    typeof row.tax === "string" &&
    typeof row.fees === "string" &&
    typeof row.date === "string"
  );
}

const DRAFT_VALIDATE: ValidateOptions = { draft: true };

/**
 * Create draft expenses from one uploaded invoice (Phase 14 §3, D-115).
 *
 * Same guard order as `app/api/files/upload/route.ts`: session, same-origin, the Plus access
 * check, a per-org rate limit, a size cap before `formData()` buffers the body. What differs
 * from a plain upload is that this route also validates and owns-checks every posted row, and
 * writes the import + its drafts in one transaction guarded by the month lock (R10.7, D-96) —
 * refused after the object is stored means the object comes back out (step 17).
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

  const limit = consume("presign", session.orgId);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many uploads at once. Wait a minute, then try again." },
      { status: 429 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_UPLOAD_BYTES + 1_000_000) {
    return NextResponse.json({ ok: false, error: "That file is larger than 25 MB." }, { status: 413 });
  }

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
  const precheckError = precheck(file);
  if (precheckError) return NextResponse.json({ ok: false, error: precheckError }, { status: 400 });

  const fundingSourceId = String(form.get("fundingSourceId") ?? "");

  // Never taken from the client: the active month, so a stale tab can't post drafts into a
  // month it no longer has open.
  const month = session.activeMonth;

  let rawRows: unknown;
  try {
    rawRows = JSON.parse(String(form.get("rows") ?? ""));
  } catch {
    return NextResponse.json({ ok: false, error: "That upload was malformed." }, { status: 400 });
  }
  if (!Array.isArray(rawRows)) {
    return NextResponse.json({ ok: false, error: "That upload was malformed." }, { status: 400 });
  }
  if (rawRows.length === 0) {
    return NextResponse.json({ ok: false, error: UI.invoiceNoRowsTicked }, { status: 400 });
  }
  // The reader's own line cap (MAX_INVOICE_LINES) — a posted array can never legitimately hold
  // more than what the reader could ever have produced.
  if (rawRows.length > MAX_INVOICE_LINES) {
    return NextResponse.json({ ok: false, error: "That upload was malformed." }, { status: 400 });
  }
  if (!rawRows.every(isPostedRow)) {
    return NextResponse.json({ ok: false, error: "That upload was malformed." }, { status: 400 });
  }
  const postedRows = rawRows as PostedRow[];

  const inputs: ExpenseInput[] = postedRows.map((row) => ({
    name: row.name,
    fundingSourceId,
    lineItemId: row.lineItemId,
    paymentSource: row.paymentSource,
    // Not stored on a draft row (schema.ts) — approval resolves the real flags off the
    // funding source at that time, same as every other create path.
    taxReimbursable: false,
    feesReimbursable: true,
    month,
    date: row.date,
    description: row.description,
    subtotal: row.subtotal,
    tax: row.tax,
    fees: row.fees,
    note: "",
    narrative: row.narrative,
    noReceipt: false,
    noReceiptReason: "",
  }));

  // Wrapped from here on: everything below reaches the database or storage, and any failure
  // must still answer with JSON, same reasoning as `app/api/files/upload/route.ts` — the
  // client parses the body, and a non-JSON 500 would reject inside a transition and replace
  // the user's check screen (with its rows still filled in) with the error page.
  try {
    const source = await findFundingSource(session.orgId, fundingSourceId);
    if (!source) return NextResponse.json({ ok: false, error: "Choose a funding source." }, { status: 400 });
    if (source.archivedAt) {
      return NextResponse.json(
        { ok: false, error: "That funding source is archived. Unarchive it in Settings to add expenses to it." },
        { status: 400 },
      );
    }

    for (const input of inputs) {
      const invalid = validate(input, DRAFT_VALIDATE);
      if (invalid) return NextResponse.json({ ok: false, error: invalid }, { status: 400 });

      if (input.lineItemId) {
        // Shape-checked before it reaches the `id` uuid column, same reasoning as `isUuid`'s
        // own doc comment — a malformed id must read as "not found", not crash the route.
        if (!isUuid(input.lineItemId)) {
          return NextResponse.json({ ok: false, error: "Choose a line item." }, { status: 400 });
        }
        const owned = await db
          .select({ id: lineItems.id })
          .from(lineItems)
          .where(
            and(
              eq(lineItems.id, input.lineItemId),
              eq(lineItems.orgId, session.orgId),
              eq(lineItems.fundingSourceId, fundingSourceId),
            ),
          )
          .limit(1);
        if (owned.length === 0) {
          return NextResponse.json({ ok: false, error: "Choose a line item." }, { status: 400 });
        }
      }

      if (!(await isKnownPaymentSource(session.orgId, input.paymentSource))) {
        return NextResponse.json({ ok: false, error: "Choose a payment source." }, { status: 400 });
      }
    }

    const inspection = await inspectUpload({
      body: Buffer.from(await file.arrayBuffer()),
      declaredMimeType: file.type,
    });
    if (!inspection.ok) return NextResponse.json({ ok: false, error: inspection.error }, { status: 400 });
    if (inspection.mimeType !== "application/pdf") {
      return NextResponse.json({ ok: false, error: UI.invoicePdfOnly }, { status: 400 });
    }
    if (inspection.pageCount > MAX_PAGES_READ) {
      return NextResponse.json(
        { ok: false, error: UI.readInvoiceTooManyPages(inspection.pageCount, MAX_PAGES_READ) },
        { status: 400 },
      );
    }

    // The sha256 stored and matched against is always the server's own hash of the bytes it
    // actually received — the client's hash (used only for the non-blocking warning) is never
    // trusted here.
    const sha256 = createHash("sha256").update(inspection.body).digest("hex");

    const fastQuotaError = await orgStorageError(db, session.orgId, inspection.body.byteLength);
    if (fastQuotaError) return NextResponse.json({ ok: false, error: fastQuotaError }, { status: 400 });

    // Fast rejection before any bytes are stored — the authoritative check runs again inside
    // the transaction below (R10.7, D-96).
    const fastLocked = await monthLocked(db, session.orgId, [{ fundingSourceId, month }]);
    if (fastLocked) {
      return NextResponse.json({ ok: false, error: UI.monthLocked(monthLabel(fastLocked.month)) }, { status: 400 });
    }

    const importId = uuidv7();
    const key = expenseImportKey({ orgId: session.orgId, month, importId });
    await storage().put({ key, body: inspection.body, contentType: inspection.mimeType });

    const vendorName = optionalString(form.get("vendorName"));
    const invoiceDate = optionalIsoDate(form.get("invoiceDate"));
    const billTaxCents = optionalCents(form.get("billTaxCents"));
    const billFeesCents = optionalCents(form.get("billFeesCents"));

    const result = await db.transaction(async (tx) => {
      // First thing inside the transaction, before any write (R10.7, D-96) — must still hold
      // even though the fast check above already refused most cases, for a page that was
      // already open before the lock landed.
      const locked = await monthLocked(tx, session.orgId, [{ fundingSourceId, month }]);
      if (locked) return { ok: false as const, error: UI.monthLocked(monthLabel(locked.month)) };

      const current = await findFundingSource(session.orgId, fundingSourceId, tx);
      if (!current || current.archivedAt) {
        return {
          ok: false as const,
          error: "That funding source is archived. Unarchive it in Settings to add expenses to it.",
        };
      }

      const quotaError = await orgStorageError(tx, session.orgId, inspection.body.byteLength);
      if (quotaError) return { ok: false as const, error: quotaError };

      await tx.insert(expenseImports).values({
        id: importId,
        orgId: session.orgId,
        fundingSourceId,
        month,
        uploadedBy: session.userId,
        s3Key: key,
        filename: file.name,
        mimeType: inspection.mimeType,
        sizeBytes: inspection.body.byteLength,
        pageCount: inspection.pageCount,
        sha256,
        vendorName,
        invoiceDate,
        billTaxCents,
        billFeesCents,
      });

      await tx.insert(expenseDrafts).values(
        inputs.map((input, index) => ({
          importId,
          orgId: session.orgId,
          fundingSourceId,
          month,
          date: input.date,
          name: input.name.trim(),
          description: input.description.trim(),
          lineItemId: input.lineItemId || null,
          paymentSource: input.paymentSource,
          subtotalCents: parseMoneyToCents(input.subtotal) ?? 0,
          taxCents: parseMoneyToCents(input.tax) ?? 0,
          feesCents: parseMoneyToCents(input.fees) ?? 0,
          narrative: input.narrative.trim() || null,
          sortOrder: index,
        })),
      );

      return { ok: true as const };
    });

    if (!result.ok) {
      // The locked-month case (and any other refusal) must leave nothing behind — neither the
      // rows (already rolled back) nor the object just stored.
      await deleteStoredObjects(key);
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("from-invoice failed", { orgId: session.orgId });
    void error;
    return NextResponse.json(
      { ok: false, error: `That file couldn't be saved. Try again, and if it keeps failing, contact support at ${UI.supportEmail}.` },
      { status: 500 },
    );
  }
}

function optionalString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalIsoDate(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  // `isValidIsoDate`, not a shape regex: "2026-13-45" matches the shape but is not a date, and
  // it would reach the `date` column as an error thrown after the object was already stored.
  return isValidIsoDate(value) ? value : null;
}

function optionalCents(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value === "") return null;
  return parseMoneyToCents(value);
}
