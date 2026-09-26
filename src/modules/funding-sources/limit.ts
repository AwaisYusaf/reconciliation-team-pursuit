import "server-only";

/**
 * The one-active-funding-source limit on Reconciliation (Phase 6 core, C8). Split from
 * `actions.ts` so the refusal rule itself stays a pure function next to its two database
 * helpers, the same shape `entitlement.ts` already uses for `activeFundingSourceLimit`.
 */
import { eq } from "drizzle-orm";

import { db } from "@/src/db";
import { billingCopyOn } from "@/src/db/billing-copy";
import { orgBilling, organizations } from "@/src/db/schema";
import type { Executor, Transaction } from "@/src/db/org-lock";
import { lockOrg } from "@/src/db/org-lock";
import { formatDateShort, type IsoDate } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { activeFundingSourceLimit, type Entitlement } from "@/src/modules/billing/entitlement";
import { fundingSourceLimit } from "@/src/modules/billing/rules";
import { ENTITLEMENT_COLUMNS, entitlementOf } from "@/src/services/auth/entitlement";

/**
 * The refusal message for activating one more funding source, or `null` to allow it.
 *
 * `queuedDowngradeAt` is Phase 3's hook: a downgrade to Reconciliation already scheduled on
 * Stripe's live schedule, not yet read by anything (nothing passes it today, so this branch is
 * unreachable until Phase 3 wires it up). `entitlement.reason !== "billing_off"` guards it: a
 * queued downgrade cannot matter while billing itself is off.
 */
export function fundingSourceLimitRefusal({
  entitlement,
  activeOthers,
  role,
  queuedDowngradeAt = null,
}: {
  entitlement: Entitlement;
  /** Active funding sources not counting the one being activated. */
  activeOthers: number;
  role: "admin" | "manager";
  queuedDowngradeAt?: IsoDate | null;
}): string | null {
  const limit = activeFundingSourceLimit(entitlement);
  if (limit !== null && activeOthers >= limit) {
    return role === "admin" ? UI.fundingSourceLimitReached : UI.fundingSourceLimitManager;
  }

  const reconciliationLimit = fundingSourceLimit("reconciliation");
  if (
    queuedDowngradeAt !== null &&
    entitlement.reason !== "billing_off" &&
    reconciliationLimit !== null &&
    activeOthers >= reconciliationLimit
  ) {
    return UI.fundingSourceLimitQueued(formatDateShort(queuedDowngradeAt));
  }

  return null;
}

async function entitlementRow(executor: Executor, orgId: string) {
  const [row] = await executor
    .select(ENTITLEMENT_COLUMNS)
    .from(organizations)
    .leftJoin(orgBilling, billingCopyOn())
    .where(eq(organizations.id, orgId))
    .limit(1);
  return row;
}

/** The org's entitlement, read under the org row lock so a concurrent create/unarchive in the
 *  same org is serialised (same reasoning as `archiveFundingSourceAction`'s lock). Locked first,
 *  then read, so the read sees whatever a writer that held the lock committed. `undefined` when
 *  the id doesn't exist. */
export async function lockedOrgEntitlement(tx: Transaction, orgId: string): Promise<Entitlement | undefined> {
  if (!(await lockOrg(tx, orgId, { id: organizations.id }))) return undefined;
  const row = await entitlementRow(tx, orgId);
  return row && entitlementOf(row);
}

/** Unlocked read of the same limit, for the Settings page only (no write follows it there). */
export async function loadFundingSourceLimit(orgId: string): Promise<number | null> {
  const row = await entitlementRow(db, orgId);
  if (!row) return null;
  return activeFundingSourceLimit(entitlementOf(row));
}
