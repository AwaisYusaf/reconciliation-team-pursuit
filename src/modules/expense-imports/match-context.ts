import "server-only";

/**
 * Loads the org's remembered recurring items and vendors for `matchInvoiceLine`
 * (src/domain/invoice-match.ts) to match against (Phase 14 §3).
 *
 * Its own file, not `queries.ts` — that file is owned by another concurrently-built phase.
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/src/db";
import { expenseImports, recurringItems, vendorDefaults } from "@/src/db/schema";
import type { RecurringMatch, VendorMatch } from "@/src/domain/invoice-match";

export async function loadInvoiceMatchContext(
  orgId: string,
): Promise<{ recurringItems: RecurringMatch[]; vendors: VendorMatch[]; earlierVendors: string[] }> {
  const [recurring, vendors, imported] = await Promise.all([
    db
      .select({
        name: recurringItems.name,
        lineItemId: recurringItems.lineItemId,
        defaultDescription: recurringItems.defaultDescription,
        defaultNarrative: recurringItems.defaultNarrative,
        defaultPaymentSource: recurringItems.defaultPaymentSource,
        defaultTaxCents: recurringItems.defaultTaxCents,
        defaultFeesCents: recurringItems.defaultFeesCents,
      })
      .from(recurringItems)
      .where(eq(recurringItems.orgId, orgId))
      .orderBy(asc(recurringItems.sortOrder)),
    db
      .select({
        name: vendorDefaults.name,
        defaultLineItemId: vendorDefaults.defaultLineItemId,
        defaultDescription: vendorDefaults.defaultDescription,
        defaultPaymentSource: vendorDefaults.defaultPaymentSource,
      })
      .from(vendorDefaults)
      .where(eq(vendorDefaults.orgId, orgId)),
    loadEarlierInvoiceVendors(orgId),
  ]);

  return { recurringItems: recurring, vendors, earlierVendors: imported };
}

/**
 * The vendors this organization's invoices have named, once each (usability #62): so
 * `withInvoiceVendor` can drop one a remembered description already starts with, and
 * `learnVendor` can keep them out of the vendor library in the first place.
 */
export async function loadEarlierInvoiceVendors(orgId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ vendorName: expenseImports.vendorName })
    .from(expenseImports)
    .where(and(eq(expenseImports.orgId, orgId), isNotNull(expenseImports.vendorName)));
  return rows.flatMap((row) => (row.vendorName ? [row.vendorName] : []));
}
