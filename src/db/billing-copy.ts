/**
 * How every query reaches an organization's Stripe copy (`org_billing`, Phase 16, D-125).
 *
 * `leftJoin(orgBilling, billingCopyOn())` also matches the row's `livemode` to the configured
 * Stripe key, so a copy written in the other mode (a test-mode subscription left in the database
 * after going live, or the reverse) reads as no copy at all: it can't grant access, and the next
 * Checkout replaces it (P11).
 */
import { and, eq } from "drizzle-orm";

import { orgBilling, organizations } from "@/src/db/schema";
import { stripeKeyIsLive } from "@/src/modules/billing/config";

/** The org's copy, in the configured Stripe mode only. */
export function billingCopyOn() {
  return and(eq(orgBilling.orgId, organizations.id), sameStripeMode());
}

/** For queries on `org_billing` alone: only rows of the configured Stripe mode. */
export function sameStripeMode() {
  return eq(orgBilling.livemode, stripeKeyIsLive());
}
