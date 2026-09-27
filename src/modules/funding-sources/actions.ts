"use server";

/**
 * Funding source management (Phase 6, D-93).
 *
 * Admins and managers may both do this (Appendix A §1) — `actionSession()`, not
 * `requireAdmin()`. Every client-supplied id is verified with `requireOwnedFundingSource`
 * before it reaches a query.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import { fundingSourceType, fundingSources, organizations } from "@/src/db/schema";
import { isValidIsoDate } from "@/src/domain/dates";
import { isDuplicateName } from "@/src/domain/line-item-rules";
import { parseMoneyToCents } from "@/src/domain/money";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession, actionSessionAnyPlan } from "@/src/lib/action-session";
import { hasPaidAccess } from "@/src/services/auth/entitlement";
import { fundingSourceLimitRefusal, lockedOrgEntitlement } from "@/src/modules/funding-sources/limit";
import { listFundingSources, requireOwnedFundingSource } from "@/src/modules/funding-sources/queries";

function revalidateAll(): void {
  revalidatePath("/", "layout");
}

export type FundingSourceInput = {
  name: string;
  type: string;
  docName: string;
  projectName: string;
  contractNumber: string;
  basePoNumber: string;
  performancePoNumber: string;
  contractValue: string;
  contractStart: string;
  contractEnd: string;
  fiduciaryName: string;
  advancesReceived: string;
  taxReimbursable: boolean;
  feesReimbursable: boolean;
};

/** Blank → 0; otherwise the parsed cents, or null when the text is not money. */
function optionalMoney(value: string): number | null {
  return value.trim() === "" ? 0 : parseMoneyToCents(value);
}

const DUPLICATE_NAME = "A funding source with that name already exists.";

/**
 * True for Postgres unique_violation (23505), raw or wrapped by Drizzle (which keeps the pg
 * error as `cause`). The app-level duplicate check runs first; this turns the race it cannot
 * close — two saves of the same name at once, stopped by `funding_sources_org_name_uq` — into
 * the same friendly refusal instead of a 500.
 */
function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown) =>
    typeof value === "object" && value !== null ? (value as { code?: unknown }).code : undefined;
  return code(error) === "23505" || code((error as { cause?: unknown })?.cause) === "23505";
}

/** Shared validation for create and update — returns the parsed values or a failure. */
async function validate(
  orgId: string,
  input: FundingSourceInput,
  ignoreId?: string,
): Promise<ActionResult<{
  name: string;
  type: (typeof fundingSourceType.enumValues)[number];
  docName: string | null;
  projectName: string;
  contractNumber: string;
  basePoNumber: string;
  performancePoNumber: string;
  contractValueCents: number;
  contractStart: string | null;
  contractEnd: string | null;
  fiduciaryName: string;
  advancesReceivedCents: number;
  taxReimbursable: boolean;
  feesReimbursable: boolean;
}>> {
  const name = input.name.trim();
  if (!name) return fail("Enter a funding source name.");

  if (!fundingSourceType.enumValues.includes(input.type as (typeof fundingSourceType.enumValues)[number])) {
    return fail("Choose a funding source type.");
  }

  const existing = await listFundingSources(orgId);
  if (isDuplicateName(name, existing, ignoreId)) {
    return fail(DUPLICATE_NAME);
  }

  // Blank means "none yet" (0), but text that does not parse is refused: `?? 0` on it saved a
  // success over a real contract value or advances figure with $0.00.
  const contractValueCents = optionalMoney(input.contractValue);
  if (contractValueCents === null) return fail("Enter a valid contract value.");
  if (contractValueCents < 0) return fail("Contract value cannot be negative.");

  const advancesReceivedCents = optionalMoney(input.advancesReceived);
  if (advancesReceivedCents === null) return fail("Enter a valid advances received amount.");
  if (advancesReceivedCents < 0) return fail("Advances received cannot be negative.");

  // Server actions are directly invocable, so the rule flags are checked rather than trusted:
  // a missing one reached the NOT NULL column as a 500, or silently kept the old rule on update.
  if (typeof input.taxReimbursable !== "boolean" || typeof input.feesReimbursable !== "boolean") {
    return fail("Choose whether this funder reimburses tax and fees.");
  }

  const start = input.contractStart.trim();
  const end = input.contractEnd.trim();
  if (start && !isValidIsoDate(start)) return fail("Enter a valid contract start date.");
  if (end && !isValidIsoDate(end)) return fail("Enter a valid contract end date.");
  if (start && end && end < start) return fail("The contract end date is before the start date.");

  const docName = input.docName.trim();

  return ok({
    name,
    type: input.type as (typeof fundingSourceType.enumValues)[number],
    docName: docName || null,
    projectName: input.projectName.trim(),
    contractNumber: input.contractNumber.trim(),
    basePoNumber: input.basePoNumber.trim(),
    performancePoNumber: input.performancePoNumber.trim(),
    contractValueCents,
    contractStart: start || null,
    contractEnd: end || null,
    fiduciaryName: input.fiduciaryName.trim(),
    advancesReceivedCents,
    taxReimbursable: input.taxReimbursable,
    feesReimbursable: input.feesReimbursable,
  });
}

export async function createFundingSourceAction(input: FundingSourceInput): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const validated = await validate(current.orgId, input);
  if (!validated.ok) return validated;

  try {
    const refused = await db.transaction(async (tx) => {
      // Locks the org row first so two concurrent creates in one org count active sources one
      // at a time, same reasoning as archiveFundingSourceAction's lock below.
      const locked = await lockedOrgEntitlement(tx, current.orgId);
      if (!locked) return fail(UI.orgNoLongerExists);

      const active = await listFundingSources(current.orgId, tx);
      const activeCount = active.filter((row) => row.archivedAt === null).length;
      const refusal = fundingSourceLimitRefusal({ ...locked, activeOthers: activeCount, role: current.role });
      if (refusal) return fail(refusal);

      const [{ value: maxSort }] = await tx
        .select({ value: sql<number>`coalesce(max(${fundingSources.sortOrder}), -1)` })
        .from(fundingSources)
        .where(eq(fundingSources.orgId, current.orgId));

      await tx.insert(fundingSources).values({
        orgId: current.orgId,
        sortOrder: Number(maxSort) + 1,
        ...validated.data,
      });
      return null;
    });
    if (refused) return refused;
  } catch (error) {
    if (isUniqueViolation(error)) return fail(DUPLICATE_NAME);
    throw error;
  }

  revalidateAll();
  return ok();
}

export async function updateFundingSourceAction(
  input: FundingSourceInput & { id: string },
): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const source = await requireOwnedFundingSource(current, input.id);
  if ("denied" in source) return source.denied;

  const validated = await validate(current.orgId, input, input.id);
  if (!validated.ok) return validated;

  try {
    await db
      .update(fundingSources)
      .set(validated.data)
      .where(and(eq(fundingSources.id, source.id), eq(fundingSources.orgId, current.orgId)));
  } catch (error) {
    if (isUniqueViolation(error)) return fail(DUPLICATE_NAME);
    throw error;
  }

  revalidateAll();
  return ok();
}

export async function archiveFundingSourceAction(id: string): Promise<ActionResult> {
  // On the paywall's allow-list (D2): an unpaid org's admin archives sources on the plan page to
  // be able to choose Reconciliation, which includes one. Only the admin: that page is theirs.
  const current = await actionSessionAnyPlan();
  if ("expired" in current) return current.expired;
  if (!hasPaidAccess(current) && current.role !== "admin") return fail(UI.billingPlanRequired);

  const source = await requireOwnedFundingSource(current, id);
  if ("denied" in source) return source.denied;

  if (source.archivedAt) {
    // Idempotent: already archived.
    revalidateAll();
    return ok();
  }

  const refused = await db.transaction(async (tx) => {
    // Lock the organisation row first so concurrent archives in one org run one at a time:
    // counted outside the transaction, two archives of an org's last two active sources each
    // saw "2 active" and both succeeded, leaving it with none.
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, current.orgId))
      .for("update");

    const active = await listFundingSources(current.orgId, tx);
    if (active.filter((row) => row.archivedAt === null).length <= 1) return true;

    await tx
      .update(fundingSources)
      .set({ archivedAt: new Date() })
      .where(and(eq(fundingSources.id, source.id), eq(fundingSources.orgId, current.orgId)));

    await tx
      .update(organizations)
      .set({ activeFundingSourceId: null })
      .where(
        and(eq(organizations.id, current.orgId), eq(organizations.activeFundingSourceId, source.id)),
      );
    return false;
  });
  if (refused) return fail("Keep at least one active funding source.");

  revalidateAll();
  return ok();
}

export async function unarchiveFundingSourceAction(id: string): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const source = await requireOwnedFundingSource(current, id);
  if ("denied" in source) return source.denied;

  if (source.archivedAt === null) {
    // Idempotent: already active.
    revalidateAll();
    return ok();
  }


  const refused = await db.transaction(async (tx) => {
    // Same lock as create: two concurrent unarchives in one org count active sources one at a
    // time, rather than each seeing "under the limit" and both succeeding.
    const locked = await lockedOrgEntitlement(tx, current.orgId);
    if (!locked) return fail(UI.orgNoLongerExists);

    const active = await listFundingSources(current.orgId, tx);
    const activeOthers = active.filter(
      (row) => row.archivedAt === null && row.id !== source.id,
    ).length;
    const refusal = fundingSourceLimitRefusal({ ...locked, activeOthers, role: current.role });
    if (refusal) return fail(refusal);

    await tx
      .update(fundingSources)
      .set({ archivedAt: null })
      .where(and(eq(fundingSources.id, source.id), eq(fundingSources.orgId, current.orgId)));
    return null;
  });
  if (refused) return refused;

  revalidateAll();
  return ok();
}
