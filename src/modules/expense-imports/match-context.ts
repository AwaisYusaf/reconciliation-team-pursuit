import "server-only";

/**
 * Loads the org's remembered recurring items and vendors for `matchInvoiceLine`
 * (src/domain/invoice-match.ts) to match against (Phase 14 §3).
 *
 * Its own file, not `queries.ts` — that file is owned by another concurrently-built phase.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "@/src/db";
import { recurringItems, vendorDefaults } from "@/src/db/schema";
import type { RecurringMatch, VendorMatch } from "@/src/domain/invoice-match";

export async function loadInvoiceMatchContext(
  orgId: string,
): Promise<{ recurringItems: RecurringMatch[]; vendors: VendorMatch[] }> {
  const [recurring, vendors] = await Promise.all([
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
  ]);

  return { recurringItems: recurring, vendors };
}
