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
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
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
    return fail("A funding source with that name already exists.");
  }

  const contractValueCents = parseMoneyToCents(input.contractValue) ?? 0;
  if (contractValueCents < 0) return fail("Contract value cannot be negative.");

  const advancesReceivedCents = parseMoneyToCents(input.advancesReceived) ?? 0;
  if (advancesReceivedCents < 0) return fail("This figure cannot be negative.");

  const start = input.contractStart.trim();
  const end = input.contractEnd.trim();
  if (start && !isValidIsoDate(start)) return fail("Enter a valid contract start date.");
  if (end && !isValidIsoDate(end)) return fail("Enter a valid contract end date.");
  if (start && end && end < start) return fail("The contract ends before it starts.");

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

  const [{ value: maxSort }] = await db
    .select({ value: sql<number>`coalesce(max(${fundingSources.sortOrder}), -1)` })
    .from(fundingSources)
    .where(eq(fundingSources.orgId, current.orgId));

  await db.insert(fundingSources).values({
    orgId: current.orgId,
    sortOrder: Number(maxSort) + 1,
    ...validated.data,
  });

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

  await db
    .update(fundingSources)
    .set(validated.data)
    .where(and(eq(fundingSources.id, source.id), eq(fundingSources.orgId, current.orgId)));

  revalidateAll();
  return ok();
}

export async function archiveFundingSourceAction(id: string): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const source = await requireOwnedFundingSource(current, id);
  if ("denied" in source) return source.denied;

  if (source.archivedAt) {
    // Idempotent: already archived.
    revalidateAll();
    return ok();
  }

  const active = await listFundingSources(current.orgId);
  const activeCount = active.filter((row) => row.archivedAt === null).length;
  if (activeCount <= 1) return fail("Keep at least one active funding source.");

  await db.transaction(async (tx) => {
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
  });

  revalidateAll();
  return ok();
}

export async function unarchiveFundingSourceAction(id: string): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const source = await requireOwnedFundingSource(current, id);
  if ("denied" in source) return source.denied;

  await db
    .update(fundingSources)
    .set({ archivedAt: null })
    .where(and(eq(fundingSources.id, source.id), eq(fundingSources.orgId, current.orgId)));

  revalidateAll();
  return ok();
}
