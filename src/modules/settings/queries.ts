import "server-only";

/**
 * Settings reads.
 *
 * Deliberately NOT in the `"use server"` module: an exported async function there becomes a
 * callable endpoint, and one taking an `orgId` argument would let any caller read another
 * organisation's settings. The org always comes from the session at the call site instead.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "@/src/db";
import {
  contractSettings,
  lineItems,
  organizations,
  paymentSources,
  supportingDocTypes,
  vendorDefaults,
} from "@/src/db/schema";

export async function loadSettings(orgId: string) {
  const [org, settings, sources, docTypes, vendors, items] = await Promise.all([
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
      .select({
        id: vendorDefaults.id,
        name: vendorDefaults.name,
        defaultLineItemId: vendorDefaults.defaultLineItemId,
        defaultDescription: vendorDefaults.defaultDescription,
        defaultPaymentSource: vendorDefaults.defaultPaymentSource,
        defaultSubtotalCents: vendorDefaults.defaultSubtotalCents,
        defaultTaxCents: vendorDefaults.defaultTaxCents,
        defaultFeesCents: vendorDefaults.defaultFeesCents,
      })
      .from(vendorDefaults)
      .where(eq(vendorDefaults.orgId, orgId))
      .orderBy(asc(vendorDefaults.name)),
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
    lineItems: items,
  };
}
