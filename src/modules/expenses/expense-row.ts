import "server-only";

/**
 * The pieces of "record an expense" that more than one create path needs.
 *
 * They live here, and not in `actions.ts`, for a reason that is a security boundary rather
 * than a matter of taste: `actions.ts` is `"use server"`, where **every export becomes a
 * publicly callable endpoint**. `learnVendor` takes an `orgId` and writes to
 * `vendor_defaults`; exported from there it was an unauthenticated cross-tenant write that
 * any caller could aim at any organisation. A plain module has no such surface.
 *
 * The same move retires the copy-and-keep-in-sync problem around it: `snapshotOf` had grown
 * three hand-maintained duplicates (here, `draft-actions.ts`, and the from-invoice route),
 * each of which had to be remembered whenever a field was added to `ExpenseAuditSnapshot`.
 * There is one now.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/src/db";
import { vendorDefaults, type ExpenseAuditSnapshot } from "@/src/db/schema";
import { parseMoneyToCentsOrZero } from "@/src/domain/money";

import type { ExpenseInput } from "./actions";

/** The column values an `expenses` insert or update is built from. */
export type ExpenseRow = {
  name: string;
  fundingSourceId: string;
  lineItemId: string;
  paymentSource: string;
  month: string;
  date: string;
  description: string;
  subtotalCents: number;
  taxCents: number;
  feesCents: number;
  taxReimbursable: boolean;
  feesReimbursable: boolean;
  note: string | null;
  narrative: string | null;
  noReceipt: boolean;
  noReceiptReason: string | null;
};

/** Form input to column values. The one place user-typed money becomes cents on this path. */
export function toRow(input: ExpenseInput): ExpenseRow {
  return {
    name: input.name.trim(),
    fundingSourceId: input.fundingSourceId,
    lineItemId: input.lineItemId,
    paymentSource: input.paymentSource,
    month: input.month,
    date: input.date,
    description: input.description.trim(),
    subtotalCents: parseMoneyToCentsOrZero(input.subtotal),
    taxCents: parseMoneyToCentsOrZero(input.tax),
    feesCents: parseMoneyToCentsOrZero(input.fees),
    taxReimbursable: input.taxReimbursable,
    feesReimbursable: input.feesReimbursable,
    note: input.note.trim() || null,
    narrative: input.narrative.trim() || null,
    noReceipt: input.noReceipt,
    noReceiptReason: input.noReceipt ? input.noReceiptReason.trim() : null,
  };
}

/**
 * The audit snapshot for one expense row.
 *
 * `fromInvoice` marks an expense the app created from a read invoice rather than one someone
 * typed (ticket §7). It rides as an extra key on the jsonb column — no migration, and every
 * existing reader names the fields it wants — and `AuditDiffContent` renders it as
 * "Created from an invoice".
 *
 * `fundingSourceId` is deliberately not part of the snapshot's field set (only the resolved
 * name is, like `lineItemName`), so it is read off explicitly rather than spread.
 */
export function snapshotOf(
  row: ExpenseRow,
  lineItemName: string,
  fundingSourceName: string,
  options: { fromInvoice?: boolean } = {},
): ExpenseAuditSnapshot {
  const snapshot: ExpenseAuditSnapshot & { fromInvoice?: true } = {
    name: row.name,
    lineItemId: row.lineItemId,
    lineItemName,
    fundingSourceName,
    paymentSource: row.paymentSource,
    month: row.month,
    date: row.date,
    description: row.description,
    subtotalCents: row.subtotalCents,
    taxCents: row.taxCents,
    feesCents: row.feesCents,
    taxReimbursable: row.taxReimbursable,
    feesReimbursable: row.feesReimbursable,
    note: row.note,
    narrative: row.narrative,
    noReceipt: row.noReceipt,
    noReceiptReason: row.noReceiptReason,
  };
  if (options.fromInvoice) snapshot.fromInvoice = true;
  return snapshot;
}

/**
 * The library learns from every save (R8.2): next time this payee is typed, its line item,
 * description and last amounts are offered automatically.
 *
 * Amounts are stored as they were saved, including zero — a vendor that genuinely charges no
 * tax is a fact worth remembering, and is distinct from the null that means nothing has been
 * learned yet.
 *
 * Callers are responsible for having established `orgId` from the session; nothing here can
 * check it, which is exactly why this must not be a `"use server"` export.
 */
export async function learnVendor(orgId: string, row: ExpenseRow): Promise<void> {
  // Uniqueness is a lower(name) expression index, which Drizzle's typed onConflict cannot
  // target, so the upsert is explicit. Latest write wins (R8.2).
  const existing = await db
    .select({ id: vendorDefaults.id })
    .from(vendorDefaults)
    .where(
      and(
        eq(vendorDefaults.orgId, orgId),
        sql`lower(${vendorDefaults.name}) = lower(${row.name})`,
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(vendorDefaults)
      .set({
        name: row.name,
        defaultLineItemId: row.lineItemId,
        defaultDescription: row.description,
        defaultPaymentSource: row.paymentSource,
        defaultSubtotalCents: row.subtotalCents,
        defaultTaxCents: row.taxCents,
        defaultFeesCents: row.feesCents,
      })
      .where(eq(vendorDefaults.id, existing[0].id));
    return;
  }

  await db
    .insert(vendorDefaults)
    .values({
      orgId,
      name: row.name,
      defaultLineItemId: row.lineItemId,
      defaultDescription: row.description,
      defaultPaymentSource: row.paymentSource,
      defaultSubtotalCents: row.subtotalCents,
      defaultTaxCents: row.taxCents,
      defaultFeesCents: row.feesCents,
    })
    .onConflictDoNothing();
}
