import "server-only";

/**
 * Configurable label lists (R5.1, R11.1 / D-19).
 *
 * Payment sources and supporting document types are org-configurable, and the chosen label
 * is stored as a snapshot on the expense — which means it prints on the cover sheet and in
 * the Excel workbook the City receives. A client could otherwise post any string it liked
 * straight onto a submitted document, so membership is verified here, in the service every
 * caller goes through, rather than in each action.
 */
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/src/db";
import { paymentSources, supportingDocTypes } from "@/src/db/schema";

/**
 * The organization's active payment sources, in the order Settings lists them. The first is the
 * default a one-click recurring add falls back to (`recurringPaymentSource`), so every screen that
 * names that default reads it from here. Label breaks a `sort_order` tie (two adds racing to the
 * same next number): without it the order, and so the default, could differ between two reads.
 */
export async function activePaymentSources(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ label: paymentSources.label })
    .from(paymentSources)
    .where(and(eq(paymentSources.orgId, orgId), eq(paymentSources.active, true)))
    .orderBy(asc(paymentSources.sortOrder), asc(paymentSources.label));
  return rows.map((row) => row.label);
}

export async function activeSupportingDocTypes(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ label: supportingDocTypes.label })
    .from(supportingDocTypes)
    .where(and(eq(supportingDocTypes.orgId, orgId), eq(supportingDocTypes.active, true)))
    .orderBy(asc(supportingDocTypes.sortOrder));
  return rows.map((row) => row.label);
}

/** True when the label is one this organisation actually offers. */
export async function isKnownPaymentSource(orgId: string, label: string): Promise<boolean> {
  const rows = await db
    .select({ id: paymentSources.id })
    .from(paymentSources)
    .where(
      and(
        eq(paymentSources.orgId, orgId),
        eq(paymentSources.label, label),
        eq(paymentSources.active, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function isKnownSupportingDocType(orgId: string, label: string): Promise<boolean> {
  const rows = await db
    .select({ id: supportingDocTypes.id })
    .from(supportingDocTypes)
    .where(
      and(
        eq(supportingDocTypes.orgId, orgId),
        eq(supportingDocTypes.label, label),
        eq(supportingDocTypes.active, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
