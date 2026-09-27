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
import { formatDateUS, type IsoDate } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { activeFundingSourceLimit, type Entitlement } from "@/src/modules/billing/entitlement";
import { fundingSourceLimit } from "@/src/modules/billing/rules";
import { ENTITLEMENT_COLUMNS, entitlementOf, reconciliationStartsOf } from "@/src/services/auth/entitlement";

/**
 * The refusal message for activating one more funding source, or `null` to allow it.
 *
 * `queuedDowngradeAt`: the day a downgrade to Reconciliation already scheduled starts
 * (`lockedOrgEntitlement`), so an admin can't queue the downgrade with one source and then add
 * more before it lands (P24). `entitlement.reason !== "billing_off"` guards it: a queued
 * downgrade cannot matter while billing itself is off.
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
    // The same 9/26/2027 form Plan & billing shows the switch date in.
    return UI.fundingSourceLimitQueued(formatDateUS(queuedDowngradeAt));
  }

  return null;
}

async function entitlementRow(executor: Executor, orgId: string) {
  const [row] = await executor
    .select({
      ...ENTITLEMENT_COLUMNS,
      pendingPlan: orgBilling.pendingPlan,
      pendingReason: orgBilling.pendingReason,
      pendingAt: orgBilling.pendingAt,
    })
    .from(organizations)
    .leftJoin(orgBilling, billingCopyOn())
    .where(eq(organizations.id, orgId))
    .limit(1);
  return row;
}

/** The org's entitlement, and the day it moves onto Reconciliation if it is about to
 *  (`reconciliationStartsOn`: a queued downgrade, or Reconciliation bought during free
 *  Reconciliation + AI; P24, `applyChange` re-syncs the copy right after queueing one). Read under
 *  the org row lock so a concurrent create/unarchive in the same org is serialised (same reasoning
 *  as `archiveFundingSourceAction`'s lock). `undefined` when the id doesn't exist. */
export async function lockedOrgEntitlement(
  tx: Transaction,
  orgId: string,
): Promise<{ entitlement: Entitlement; queuedDowngradeAt: IsoDate | null } | undefined> {
  if (!(await lockOrg(tx, orgId, { id: organizations.id }))) return undefined;
  const row = await entitlementRow(tx, orgId);
  if (!row) return undefined;
  return { entitlement: entitlementOf(row), queuedDowngradeAt: reconciliationStartsOf(row) };
}

/** Unlocked read of the same limit, for the Settings page only (no write follows it there). */
export async function loadFundingSourceLimit(orgId: string): Promise<number | null> {
  const row = await entitlementRow(db, orgId);
  if (!row) return null;
  return activeFundingSourceLimit(entitlementOf(row));
}
