"use server";

/**
 * Settings (m09) — everything the prototype hardcoded.
 *
 * These values print on the documents the City receives (organisation name, PO numbers,
 * contract figures) or govern what may be recorded (the label lists), so each section is
 * validated and saved independently.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import {
  contractSettings,
  fundingSources,
  organizations,
  paymentSources,
  supportingDocTypes,
  users,
  vendorDefaults,
} from "@/src/db/schema";
import { isValidIsoDate } from "@/src/domain/dates";
import { parseMoneyToCents } from "@/src/domain/money";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { primaryFundingSourceId } from "@/src/modules/funding-sources/queries";
import { consume, reset as resetLimit } from "@/src/services/rate-limit";
import { isUuid } from "@/src/lib/ids";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "@/src/services/auth/passwords";
import { revokeOtherSessions } from "@/src/services/auth/session";


/* --------------------------------------------------------- organisation */

export async function updateOrganisationAction(input: {
  name: string;
  docName: string;
}): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const name = input.name.trim();
  const docName = input.docName.trim();
  if (!name) return fail("Enter your organisation's name.");
  // The document name is part of every generated filename and title, so it cannot be blank.
  if (!docName) return fail("Enter the name to print on documents.");

  await db
    .update(organizations)
    .set({ name, docName })
    .where(eq(organizations.id, current.orgId));

  revalidatePath("/", "layout");
  return ok();
}

/* ------------------------------------------------------------ contract */

export async function updateContractAction(input: {
  projectName: string;
  contractNumber: string;
  basePoNumber: string;
  performancePoNumber: string;
  contractValue: string;
  contractStart: string;
  contractEnd: string;
  fiduciaryName: string;
}): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const contractValueCents = parseMoneyToCents(input.contractValue) ?? 0;
  if (contractValueCents < 0) return fail("Contract value cannot be negative.");

  const start = input.contractStart.trim();
  const end = input.contractEnd.trim();
  if (start && !isValidIsoDate(start)) return fail("Enter a valid contract start date.");
  if (end && !isValidIsoDate(end)) return fail("Enter a valid contract end date.");
  if (start && end && end < start) return fail("The contract ends before it starts.");

  const values = {
    projectName: input.projectName.trim(),
    contractNumber: input.contractNumber.trim(),
    basePoNumber: input.basePoNumber.trim(),
    performancePoNumber: input.performancePoNumber.trim(),
    contractValueCents,
    contractStart: start || null,
    contractEnd: end || null,
    fiduciaryName: input.fiduciaryName.trim(),
  };

  // ponytail: dual-write until Phase 3 replaces this with updateFundingSourceAction; delete the contract_settings half then.
  await db.transaction(async (tx) => {
    await tx
      .insert(contractSettings)
      .values({ orgId: current.orgId, ...values })
      .onConflictDoUpdate({ target: contractSettings.orgId, set: values });

    const fundingSourceId = await primaryFundingSourceId(current.orgId, tx);
    await tx.update(fundingSources).set(values).where(eq(fundingSources.id, fundingSourceId));
  });

  revalidatePath("/", "layout");
  return ok();
}

/* ------------------------------------------------------------- advances */

/**
 * The Performance Grant figures this action used to update now live per line item as
 * performances (m08) instead — see `addLineItemPerformanceAction` in
 * `modules/line-items/actions.ts`. Only Advances Received is a settings-level figure.
 */
export async function updateAdvancesReceivedAction(input: {
  advancesReceived: string;
}): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const advancesReceivedCents = parseMoneyToCents(input.advancesReceived) ?? 0;
  if (advancesReceivedCents < 0) return fail("This figure cannot be negative.");

  // ponytail: dual-write until Phase 3 replaces this with updateFundingSourceAction; delete the contract_settings half then.
  await db.transaction(async (tx) => {
    await tx
      .insert(contractSettings)
      .values({ orgId: current.orgId, advancesReceivedCents })
      .onConflictDoUpdate({
        target: contractSettings.orgId,
        set: { advancesReceivedCents },
      });

    const fundingSourceId = await primaryFundingSourceId(current.orgId, tx);
    await tx
      .update(fundingSources)
      .set({ advancesReceivedCents })
      .where(eq(fundingSources.id, fundingSourceId));
  });

  revalidatePath("/", "layout");
  return ok();
}

/* ------------------------------------------------------------- lists */

/**
 * Set what a funder reimburses (R1.3, D-67).
 *
 * Stored on the payment source because that is the thing that actually decides — the client's
 * own framing was "different funding sources have different reimbursement requirements".
 * Changing it here sets the default for *new* expenses only; every saved expense keeps the
 * rules it was claimed under, so a rule change never silently restates a submitted figure.
 */
export async function updateReimbursementRulesAction(input: {
  id: string;
  taxReimbursable: boolean;
  feesReimbursable: boolean;
}): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(input.id)) return fail("That payment source no longer exists.");

  const updated = await db
    .update(paymentSources)
    .set({
      taxReimbursable: input.taxReimbursable,
      feesReimbursable: input.feesReimbursable,
    })
    .where(and(eq(paymentSources.id, input.id), eq(paymentSources.orgId, current.orgId)))
    .returning({ id: paymentSources.id });
  if (updated.length === 0) return fail("That payment source no longer exists.");

  revalidatePath("/", "layout");
  return ok();
}

type ListKind = "paymentSource" | "supportingDocType";

function table(kind: ListKind) {
  return kind === "paymentSource" ? paymentSources : supportingDocTypes;
}

/**
 * Add or rename a label.
 *
 * Renaming changes what future entries offer; expenses already recorded keep the label
 * they were saved with, which is what makes their documents reproducible (R5.1).
 */
export async function saveLabelAction(input: {
  kind: ListKind;
  id?: string;
  label: string;
}): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  const label = input.label.trim();
  if (!label) return fail("Enter a label.");
  if (input.id && !isUuid(input.id)) return fail("That entry no longer exists.");

  const target = table(input.kind);

  const clash = await db
    .select({ id: target.id })
    .from(target)
    .where(and(eq(target.orgId, current.orgId), sql`lower(${target.label}) = lower(${label})`))
    .limit(1);
  if (clash[0] && clash[0].id !== input.id) return fail("That label already exists.");

  if (input.id) {
    const updated = await db
      .update(target)
      .set({ label })
      .where(and(eq(target.id, input.id), eq(target.orgId, current.orgId)))
      .returning({ id: target.id });
    if (updated.length === 0) return fail("That entry no longer exists.");
  } else {
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${target.sortOrder}), -1) + 1` })
      .from(target)
      .where(eq(target.orgId, current.orgId));
    await db
      .insert(target)
      .values({ orgId: current.orgId, label, sortOrder: Number(next) });
  }

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Activate or deactivate a label.
 *
 * Labels are never hard-deleted: an expense stores the label it was entered with, and
 * keeping the row lets Settings still show what that history refers to. Deactivating just
 * takes it out of the pickers.
 */
export async function setLabelActiveAction(input: {
  kind: ListKind;
  id: string;
  active: boolean;
}): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(input.id)) return fail("That entry no longer exists.");

  const target = table(input.kind);

  // Expense entry requires a payment source, so the last active one cannot be turned off.
  if (!input.active && input.kind === "paymentSource") {
    const active = await db
      .select({ id: target.id })
      .from(target)
      .where(and(eq(target.orgId, current.orgId), eq(target.active, true)));
    if (active.length <= 1) return fail("Keep at least one payment source active.");
  }

  const updated = await db
    .update(target)
    .set({ active: input.active })
    .where(and(eq(target.id, input.id), eq(target.orgId, current.orgId)))
    .returning({ id: target.id });
  if (updated.length === 0) return fail("That entry no longer exists.");

  revalidatePath("/", "layout");
  return ok();
}

/* --------------------------------------------------------- vendor library */

export async function saveVendorAction(input: {
  id: string;
  name: string;
  defaultLineItemId: string | null;
  defaultDescription: string;
  defaultPaymentSource: string | null;
  /** Blank clears the remembered amount back to "nothing learned" rather than to zero. */
  defaultSubtotal: string;
  defaultTax: string;
  defaultFees: string;
}): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(input.id)) return fail("That vendor no longer exists.");

  const name = input.name.trim();
  if (!name) return fail("Enter a name.");

  const clash = await db
    .select({ id: vendorDefaults.id })
    .from(vendorDefaults)
    .where(
      and(
        eq(vendorDefaults.orgId, current.orgId),
        sql`lower(${vendorDefaults.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (clash[0] && clash[0].id !== input.id) return fail("A vendor with that name already exists.");

  const updated = await db
    .update(vendorDefaults)
    .set({
      name,
      defaultLineItemId: input.defaultLineItemId,
      defaultDescription: input.defaultDescription.trim(),
      defaultPaymentSource: input.defaultPaymentSource,
      defaultSubtotalCents: parseMoneyToCents(input.defaultSubtotal),
      defaultTaxCents: parseMoneyToCents(input.defaultTax),
      defaultFeesCents: parseMoneyToCents(input.defaultFees),
    })
    .where(and(eq(vendorDefaults.id, input.id), eq(vendorDefaults.orgId, current.orgId)))
    .returning({ id: vendorDefaults.id });
  if (updated.length === 0) return fail("That vendor no longer exists.");

  revalidatePath("/", "layout");
  return ok();
}

/** Forget a vendor. Expenses keep their own values; only the autofill entry goes. */
export async function deleteVendorAction(id: string): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;
  if (!isUuid(id)) return fail("That vendor no longer exists.");

  const deleted = await db
    .delete(vendorDefaults)
    .where(and(eq(vendorDefaults.id, id), eq(vendorDefaults.orgId, current.orgId)))
    .returning({ id: vendorDefaults.id });
  if (deleted.length === 0) return fail("That vendor no longer exists.");

  revalidatePath("/", "layout");
  return ok();
}

/* ------------------------------------------------------------- account */

/**
 * Change the password (D-06).
 *
 * Every other session is revoked, so a password changed because it may have been exposed
 * actually ends the exposure. The caller stays signed in.
 */
export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  // Verifying the current password is an argon2 oracle for anyone holding a stolen cookie,
  // so it is bounded. Keyed on the user rather than an address: the attacker here is already
  // inside the session, so their network position tells us nothing.
  const budget = consume("passwordChange", current.userId);
  if (!budget.allowed) {
    const minutes = Math.ceil(budget.retryAfterSeconds / 60);
    return fail(`Too many password attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }

  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, current.userId))
    .limit(1);
  if (!user) return fail("That account no longer exists.");

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    return fail("That is not your current password.");
  }

  const policyError = validatePasswordPolicy(input.newPassword);
  if (policyError) return fail(policyError);
  if (input.newPassword !== input.confirmPassword) return fail("The new passwords don't match.");
  if (input.newPassword === input.currentPassword) {
    return fail("Choose a password different from the current one.");
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(input.newPassword) })
    .where(eq(users.id, current.userId));

  await revokeOtherSessions(current.userId);
  // The password is now known-good, so the budget spent proving it is returned — an honest
  // user who mistyped twice before succeeding is not left throttled.
  resetLimit("passwordChange", current.userId);

  return ok();
}
