import "server-only";

/**
 * Settings reads.
 *
 * Deliberately NOT in the `"use server"` module: an exported async function there becomes a
 * callable endpoint, and one taking an `orgId` argument would let any caller read another
 * organisation's settings. The org always comes from the session at the call site instead.
 */
import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/src/db";
import {
  contractSettings,
  lineItems,
  organizations,
  paymentSources,
  supportingDocTypes,
  vendorDefaults,
} from "@/src/db/schema";

/** Rows on the Settings page's vendor preview — the full library is its own paginated screen. */
const VENDOR_PREVIEW_SIZE = 3;

const VENDOR_COLUMNS = {
  id: vendorDefaults.id,
  name: vendorDefaults.name,
  defaultLineItemId: vendorDefaults.defaultLineItemId,
  defaultDescription: vendorDefaults.defaultDescription,
  defaultPaymentSource: vendorDefaults.defaultPaymentSource,
  defaultSubtotalCents: vendorDefaults.defaultSubtotalCents,
  defaultTaxCents: vendorDefaults.defaultTaxCents,
  defaultFeesCents: vendorDefaults.defaultFeesCents,
};

export async function loadSettings(orgId: string) {
  const [org, settings, sources, docTypes, vendors, vendorCount, items] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1),
    db.select().from(contractSettings).where(eq(contractSettings.orgId, orgId)).limit(1),
    db
      .select()
      .from(paymentSources)
      .where(eq(paymentSources.orgId, orgId))
      .orderBy(asc(paymentSources.sortOrder)),
    db
      .select()
      .from(supportingDocTypes)
      .where(eq(supportingDocTypes.orgId, orgId))
      .orderBy(asc(supportingDocTypes.sortOrder)),
    db
      .select(VENDOR_COLUMNS)
      .from(vendorDefaults)
      .where(eq(vendorDefaults.orgId, orgId))
      .orderBy(asc(vendorDefaults.name))
      .limit(VENDOR_PREVIEW_SIZE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(vendorDefaults)
      .where(eq(vendorDefaults.orgId, orgId)),
    db
      .select({ id: lineItems.id, name: lineItems.name })
      .from(lineItems)
      .where(eq(lineItems.orgId, orgId))
      .orderBy(asc(lineItems.sortOrder)),
  ]);

  return {
    org: org[0],
    settings: settings[0] ?? null,
    sources,
    docTypes,
    vendors,
    vendorCount: vendorCount[0]?.count ?? 0,
    lineItems: items,
  };
}

export const VENDORS_PAGE_SIZE = 20;

/**
 * The full vendor library screen's data — searchable and paginated, since a library that
 * grows for months of expense entry shouldn't mean paging through hundreds of rows or
 * shipping them all to the browser at once (R8.2's "the library learns from every save").
 */
export async function loadVendorsPage(
  orgId: string,
  { query, page }: { query: string; page: number },
) {
  const term = query.trim();
  const where = term
    ? and(eq(vendorDefaults.orgId, orgId), sql`${vendorDefaults.name} ilike ${"%" + term + "%"}`)
    : eq(vendorDefaults.orgId, orgId);

  const [vendors, count, paymentSourceRows, lineItemRows] = await Promise.all([
    db
      .select(VENDOR_COLUMNS)
      .from(vendorDefaults)
      .where(where)
      .orderBy(asc(vendorDefaults.name))
      .limit(VENDORS_PAGE_SIZE)
      .offset((page - 1) * VENDORS_PAGE_SIZE),
    db.select({ count: sql<number>`count(*)::int` }).from(vendorDefaults).where(where),
    db
      .select()
      .from(paymentSources)
      .where(eq(paymentSources.orgId, orgId))
      .orderBy(asc(paymentSources.sortOrder)),
    db
      .select({ id: lineItems.id, name: lineItems.name })
      .from(lineItems)
      .where(eq(lineItems.orgId, orgId))
      .orderBy(asc(lineItems.sortOrder)),
  ]);

  return {
    vendors,
    total: count[0]?.count ?? 0,
    paymentSources: paymentSourceRows,
    lineItems: lineItemRows,
  };
}
