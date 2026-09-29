import { createHash } from "crypto";

import { and, eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { v7 as uuidv7 } from "uuid";

import { db } from "@/src/db";
import { LINE_ITEM_GONE, unlessLineItemGone } from "@/src/db/pg-errors";
import { expenseDrafts, expenseImports, expenses, lineItems } from "@/src/db/schema";
import { isValidIsoDate, monthLabel } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { parseMoneyToCentsOrZero } from "@/src/domain/money";
import { SESSION_EXPIRED } from "@/src/lib/action-result";
import { routeSession } from "@/src/lib/route-session";
import { sameOrigin } from "@/src/lib/same-origin";
import { isUuid } from "@/src/lib/ids";
import { readAmountsAllowedForOrg } from "@/src/modules/ai/access";
import { MAX_PAGES_READ } from "@/src/modules/amount-reading/page-cap";
import { findFundingSource } from "@/src/modules/funding-sources/queries";
import { monthLocked } from "@/src/modules/packet/month-guard";
import { isKnownPaymentSource } from "@/src/modules/settings/labels";
import { validate, type ValidateOptions } from "@/src/modules/expenses/validation";
import { rulesForFundingSource } from "@/src/modules/expenses/reimbursement";
import type { ExpenseInput } from "@/src/modules/expenses/actions";
import { insertExpenseWithAudit, learnVendor, toRow, type ExpenseRow } from "@/src/modules/expenses/expense-row";
import { MAX_INVOICE_LINES } from "@/src/services/openai/read-invoice";
import { sweepOrphanImports } from "@/src/modules/expense-imports/orphan-imports";
import { consume } from "@/src/services/rate-limit";
import { storage } from "@/src/services/storage/driver";
import {
  attachImportAsReceipt,
  deleteStoredObjects,
  ingestDraftDocument,
  ingestExpenseDocument,
  orgStorageError,
  precheck,
} from "@/src/services/storage/documents";
import { inspectUpload } from "@/src/services/storage/inspect";
import { expenseImportKey, MAX_UPLOAD_BYTES, thumbnailKey } from "@/src/services/storage/keys";

export const runtime = "nodejs";

/** Kept in step with the read route's own list: a file that could be read must also be storable. */
const READABLE_INVOICE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/** One ticked row as posted from the check screen — money still the on-screen strings, the
 *  amounts and the line item/payment source ownership are all re-verified below, never trusted
 *  from the client (Phase 14 §3, ticket §3). */
type PostedRow = {
  name: string;
  lineItemId: string;
  paymentSource: string;
  description: string;
  narrative: string;
  note: string;
  /** What this charge becomes: a real expense now, or a draft waiting for review. */
  kind: "expense" | "draft";
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
    typeof row.note === "string" &&
    (row.kind === "expense" || row.kind === "draft") &&
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

  // The month is the person's own (`users.active_month`, Phase 18), never a value the client
  // chose — but the screen posts the month it RENDERED for, and the two must still agree. The
  // same person switching month in another tab or on another device while these charges were
  // being reviewed would otherwise send the whole invoice into a month this screen never showed,
  // spending that month's reference numbers on it. Refused rather than silently redirected: the
  // charges are all still on screen, and re-reading the month is the only honest way to continue.
  const month = session.activeMonth;
  const postedMonth = String(form.get("month") ?? "");
  if (postedMonth && postedMonth !== month) {
    return NextResponse.json({ ok: false, error: UI.invoiceMonthChanged(monthLabel(month)) }, { status: 409 });
  }

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
    return NextResponse.json({ ok: false, error: UI.invoiceNoCharges }, { status: 400 });
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
    note: row.note,
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

    for (const [index, input] of inputs.entries()) {
      // A charge saved as a real expense has to clear the full rule set, line item and
      // narrative included: it is about to appear in a month total and on a cover sheet, and
      // nothing downstream would ever ask again. A draft clears the relaxed set, because
      // being unfinished is the whole point of one. The refusal names the charge, since the
      // person is looking at a list of them and "enter a narrative" alone would not say which.
      const kind = postedRows[index].kind;
      const invalid = validate(input, kind === "expense" ? {} : DRAFT_VALIDATE);
      if (invalid) {
        const label = input.name.trim() || `Charge ${index + 1}`;
        return NextResponse.json({ ok: false, error: `${label}: ${invalid}` }, { status: 400 });
      }

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
    if (!READABLE_INVOICE_TYPES.includes(inspection.mimeType)) {
      return NextResponse.json({ ok: false, error: UI.invoiceFileType }, { status: 400 });
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
    const key = expenseImportKey({
      orgId: session.orgId,
      month,
      importId,
      mimeType: inspection.mimeType,
    });
    await storage().put({ key, body: inspection.body, contentType: inspection.mimeType });
    // The preview square, for a photographed invoice. `inspectUpload` has already made it, and
    // it is stored here rather than regenerated later because this same object becomes the
    // receipt on every expense the bill produces (`attachImportAsReceipt`), and the expenses
    // table asks for a thumbnail on anything that is not a PDF. Without this the table showed
    // a broken image on every one of them. A PDF has none, exactly as a PDF receipt has none.
    if (inspection.thumbnail) {
      await storage().put({
        key: thumbnailKey(key),
        body: inspection.thumbnail,
        contentType: "image/jpeg",
      });
    }

    const vendorName = optionalString(form.get("vendorName"));
    const invoiceDate = optionalIsoDate(form.get("invoiceDate"));
    const billTaxCents = optionalCents(form.get("billTaxCents"));
    const billFeesCents = optionalCents(form.get("billFeesCents"));

    // Filled inside the transaction, read after it commits: the invoice becomes each real
    // expense's receipt through `ingestExpenseDocument`, which opens its own transaction and
    // therefore cannot run inside this one.
    const createdExpenseIds: Array<{ expenseId: string; rowIndex: number; row: ExpenseRow }> = [];
    // The same for drafts: a card marked "draft" can carry proof and supporting files too, and
    // they hang off `expense_draft_documents` until approval re-points them at the expense.
    const createdDraftIds: Array<{ draftId: string; rowIndex: number }> = [];

    // Resolved before the transaction: it reads the funding source itself, and the flags it
    // returns are the only supplier for `taxReimbursable`/`feesReimbursable`, which have no
    // column default precisely so that forgetting them is a type error (schema.ts).
    const rules = await rulesForFundingSource(session.orgId, fundingSourceId);

    const result = await unlessLineItemGone(() => db.transaction(async (tx) => {
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
        thumbnailBytes: inspection.thumbnail?.byteLength ?? 0,
        pageCount: inspection.pageCount,
        sha256,
        vendorName,
        invoiceDate,
        billTaxCents,
        billFeesCents,
      });

      // Split by what the person chose on each card. Both kinds are written inside this one
      // transaction, after `monthLocked` above, so a month that locks mid-import writes
      // neither and the invoice is not half imported.
      // Index kept for the same reason the expense list keeps it: a draft's own queued files
      // have to find their way back to the draft that card became.
      const draftInputs = inputs
        .map((input, index) => ({ input, index }))
        .filter(({ index }) => postedRows[index].kind === "draft");
      // Index kept, not dropped: each created expense has to be matched back to the card it
      // came from so that card's own proof and supporting files attach to it.
      const expenseInputs = inputs
        .map((input, index) => ({ input, index }))
        .filter(({ index }) => postedRows[index].kind === "expense");

      if (expenseInputs.length > 0) {
        // Same counter every other create path reads, and deliberately not filtered on
        // `deletedAt`: a trashed row keeps its sortOrder (expenses/actions.ts).
        const [{ next: firstSort }] = await tx
          .select({ next: sql<number>`coalesce(max(${expenses.sortOrder}), -1) + 1` })
          .from(expenses)
          .where(and(eq(expenses.orgId, session.orgId), eq(expenses.month, month)));

        for (const [offset, { input, index: rowIndex }] of expenseInputs.entries()) {
          // The same `toRow` every other create path uses, so the amounts reach the column
          // through one parser and the audit snapshot below is built from the same object as
          // the insert rather than a second hand-written field list. The two reimbursement
          // flags are the exception: `inputs` carries placeholders (they are not a draft
          // column), and the funding source is their only supplier.
          const row: ExpenseRow = {
            ...toRow(input),
            taxReimbursable: rules.taxReimbursable,
            feesReimbursable: rules.feesReimbursable,
          };

          const [item] = await tx
            .select({ name: lineItems.name })
            .from(lineItems)
            .where(eq(lineItems.id, input.lineItemId))
            .limit(1);

          // The one supplier for row + reference + audit event, shared with
          // `createExpenseAction` and `approveDraftAction`. The sort order is passed because
          // this loop already read the month's counter once for the whole batch.
          const inserted = await insertExpenseWithAudit(tx, {
            orgId: session.orgId,
            actorUserId: session.userId,
            row,
            lineItemName: item?.name ?? "",
            fundingSourceName: current.name,
            fromInvoice: true,
            sortOrder: Number(firstSort) + offset,
          });
          createdExpenseIds.push({ expenseId: inserted.id, rowIndex, row });
        }
      }

      if (draftInputs.length > 0) {
        const insertedDrafts = await tx
          .insert(expenseDrafts)
          .values(
            draftInputs.map(({ input }, index) => ({
              importId,
              orgId: session.orgId,
              fundingSourceId,
              month,
              date: input.date,
              name: input.name.trim(),
              description: input.description.trim(),
              lineItemId: input.lineItemId || null,
              paymentSource: input.paymentSource,
              subtotalCents: parseMoneyToCentsOrZero(input.subtotal),
              taxCents: parseMoneyToCentsOrZero(input.tax),
              feesCents: parseMoneyToCentsOrZero(input.fees),
              narrative: input.narrative.trim() || null,
              note: input.note.trim() || null,
              sortOrder: index,
              // Whoever read the invoice in is both the author and, until someone edits it,
              // the last person to have saved it.
              createdByUserId: session.userId,
              updatedByUserId: session.userId,
            })),
          )
          .returning({ id: expenseDrafts.id });

        // RETURNING comes back in the order the values were given, which is the order
        // `draftInputs` is in — so position `i` here is `draftInputs[i]`'s card.
        insertedDrafts.forEach((inserted, i) => {
          createdDraftIds.push({ draftId: inserted.id, rowIndex: draftInputs[i].index });
        });
      }

      return { ok: true as const };
    }));

    // A line item chosen for a charge was deleted by someone else mid-save: nothing was written.
    if (result === LINE_ITEM_GONE) {
      await deleteStoredObjects(key);
      return NextResponse.json({ ok: false, error: UI.lineItemGone }, { status: 409 });
    }
    if (!result.ok) {
      // The locked-month case (and any other refusal) must leave nothing behind — neither the
      // rows (already rolled back) nor the object just stored.
      await deleteStoredObjects(key);
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    // What did not attach, so the answer can name it. A failure here never undoes the row that
    // already exists — the expense or draft is real either way — but it must not be silent:
    // the file is gone from the browser once this request returns, and a success toast over a
    // dropped receipt is the one outcome nobody can recover from.
    const attachmentErrors: Array<{ filename: string; reason: string }> = [];

    /**
     * The files queued on one card, attached to whatever that card became.
     *
     * The scope comes from the field name and is never guessed from the file: a proof filed as
     * a supporting document would leave the expense failing the documentation gate for a
     * reason nobody could see. Only the three real scopes are read, so a made-up one is
     * ignored rather than stored.
     *
     * `supportingType` rides in a parallel field appended in lockstep by the screen, so the
     * nth type belongs to the nth file of that scope. Without it every supporting document was
     * refused with "Choose a document type first." and then dropped without a word.
     */
    async function attachQueued(
      rowIndex: number,
      ingest: (
        scope: "proof" | "receipt" | "supporting",
        file: File,
        supportingType: string | null,
      ) => Promise<{ ok: boolean; error?: string }>,
    ): Promise<void> {
      for (const scope of ["proof", "receipt", "supporting"] as const) {
        const queuedFiles = form.getAll(`rowFiles-${rowIndex}-${scope}`);
        const types = scope === "supporting" ? form.getAll(`rowFileTypes-${rowIndex}-supporting`) : [];
        for (const [position, queued] of queuedFiles.entries()) {
          if (!(queued instanceof File)) continue;
          const declared = typeof types[position] === "string" ? String(types[position]) : "";
          try {
            const result = await ingest(scope, queued, declared || null);
            if (!result.ok) {
              attachmentErrors.push({ filename: queued.name, reason: result.error ?? UI.uploadFailed });
            }
          } catch {
            attachmentErrors.push({ filename: queued.name, reason: UI.uploadFailed });
          }
        }
      }
    }

    // Same treatment approval gives it: a failed attach never undoes an expense that already
    // exists, it just leaves it without a receipt, which the missing-documents column already
    // shows. The stored object is the import's, so it is not deleted here on failure.
    for (const { expenseId, rowIndex } of createdExpenseIds) {
      try {
        // Re-pointed at the object the import already stored, never stored again: a 25-line
        // invoice saved straight as expenses used to write 26 copies of the same file, all of
        // them counted against the organisation's 5 GB cap.
        await attachImportAsReceipt(db, {
          orgId: session.orgId,
          expenseId,
          imported: {
            s3Key: key,
            filename: file.name,
            mimeType: inspection.mimeType,
            sizeBytes: inspection.body.byteLength,
            thumbnailBytes: inspection.thumbnail?.byteLength ?? 0,
            pageCount: inspection.pageCount,
          },
        });
      } catch {
        // Deliberately swallowed, per the comment above.
      }

      // Whatever the person queued on that card. They could not be uploaded earlier: there was
      // no expense to attach them to until the transaction above created one. A failure here
      // leaves the expense without that file, which the missing-documents column already says.
      // The scope is in the field name, never guessed from the file: a proof filed as a
      // supporting document would leave the expense failing the documentation gate for a
      // reason nobody could see. Only the three real scopes are read, so a made-up one is
      // simply ignored rather than stored.
      await attachQueued(rowIndex, (scope, file, supportingType) =>
        ingestExpenseDocument({ orgId: session.orgId, expenseId, scope, supportingType, file }),
      );
    }

    // A draft's own queued files, attached the same way and with the same swallow: a failed
    // attach must not undo a draft that already exists, and the review row already says what
    // the draft is still missing.
    for (const { draftId, rowIndex } of createdDraftIds) {
      await attachQueued(rowIndex, (scope, file, supportingType) =>
        ingestDraftDocument({ orgId: session.orgId, draftId, scope, supportingType, file }),
      );
    }

    // Invoices nothing came of: every draft discarded and no expense using the file. Swept
    // here rather than at the discard that emptied them, because `undoDiscardAction` restores
    // a draft against its original import and deleting it there breaks Undo. Best effort — a
    // failed sweep must not fail an import that has already been written.
    try {
      await sweepOrphanImports(session.orgId);
    } catch {
      // Left for the next read to pick up.
    }

    // The library learns from every save (R8.2), exactly as `createExpenseAction` and
    // `approveDraftAction` do — without this, an expense saved straight off an invoice taught
    // the vendor library nothing, so the same vendor's next invoice would not match itself
    // (the feature's own rule 2, PHASE-14.md §5). After commit, like the other two paths.
    for (const { row } of createdExpenseIds) {
      await learnVendor(session.orgId, row);
    }

    // `ok` either way: everything the person chose was written. `attachmentErrors` names the
    // files that did not make it, so the screen can say so rather than claim a clean save.
    return NextResponse.json({ ok: true, attachmentErrors });
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

/**
 * The whole-bill tax or fee, which arrives from the check screen ALREADY IN CENTS —
 * `readInvoice` returns `billTaxCents`/`billFeesCents` as integers and the client posts them
 * with `String(...)`.
 *
 * Read as an integer, deliberately not through `parseMoneyToCents`: that parser reads its
 * input as DOLLARS, so a $12.50 bill tax posted as "1250" came back as 125000 and was stored
 * as $1,250.00 — the format-then-parse round trip domain-rules R1.1 forbids, on an amount the
 * model supplied. Anything that is not a plain integer is treated as "never read" (null),
 * which is a different fact from zero (data-model).
 */
function optionalCents(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value === "") return null;
  // The exact shape, not `Number()`: this is a public endpoint writing a cents column, and
  // `Number` also accepts "1e3" (1000), "0x10" (16), surrounding whitespace and negatives.
  // A leading minus is allowed deliberately, because a credit note really can carry negative
  // tax (R1.4); everything else is refused as "never read", which is not the same as zero.
  if (!/^-?\d{1,12}$/.test(value)) return null;
  const cents = Number(value);
  return Number.isSafeInteger(cents) ? cents : null;
}
