"use server";

/**
 * AB Solutions staff account actions (Phase 9 §3.10, §5): change plan/status, turn
 * complimentary access on or off, suspend and reinstate. Every action locks the organisation
 * row first (`SELECT … FOR UPDATE`, D-98 decision 10) so two staff acting on one org at once
 * give one success and one refusal, then writes an `org_account_events` row in the same
 * transaction — the client calls `router.refresh()` after a success (Phase 4), which is why
 * nothing here calls `revalidatePath`.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/src/db";
import { billingCopyOn, sameStripeMode } from "@/src/db/billing-copy";
import {
  orgAccountEvents,
  orgBilling,
  organizations,
  orgPlan,
  sessions,
  subscriptionStatus,
  users,
  type OrgAccountSnapshot,
  type OrgPlan,
  type SubscriptionStatus,
} from "@/src/db/schema";
import { lockOrg, type Executor } from "@/src/db/org-lock";
import { isValidIsoDate } from "@/src/domain/dates";
import { ACCOUNT_NOTE_MAX_LENGTH, UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { requireStaff } from "@/src/lib/action-session";
import { isUuid } from "@/src/lib/ids";
import { billingEnabled } from "@/src/modules/billing/config";
import { complimentaryStripeStep, isLive } from "@/src/modules/billing/rules";
import {
  BillingError,
  setCollectionPaused,
  staffCancelSubscription,
  staffMoveFirstCharge,
} from "@/src/modules/billing/billing";
import { alert, refreshOrgBilling } from "@/src/modules/billing/sync";

type OrgRow = {
  id: string;
  plan: OrgPlan;
  subscriptionStatus: SubscriptionStatus;
  complimentary: boolean;
  complimentaryUntil: string | null;
  complimentaryPlan: OrgPlan | null;
  suspendedAt: Date | null;
  stripeStatus: string | null;
};

function isOrgPlan(value: string): value is OrgPlan {
  return (orgPlan.enumValues as readonly string[]).includes(value);
}

function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (subscriptionStatus.enumValues as readonly string[]).includes(value);
}

function snapshot(row: OrgRow): OrgAccountSnapshot {
  return {
    plan: row.plan,
    status: row.subscriptionStatus,
    complimentary: row.complimentary,
    complimentaryUntil: row.complimentaryUntil,
    suspended: row.suspendedAt !== null,
  };
}

/** Trims a note and refuses one over `ACCOUNT_NOTE_MAX_LENGTH`; an empty note is stored `null`. */
function parseNote(note: string): { value: string | null } | { refusal: ActionResult<never> } {
  const trimmed = note.trim();
  if (trimmed.length > ACCOUNT_NOTE_MAX_LENGTH) {
    return { refusal: fail(UI.accountNoteTooLong(ACCOUNT_NOTE_MAX_LENGTH)) };
  }
  return { value: trimmed || null };
}

/**
 * Locks the organisation row inside a transaction and runs `fn` with the locked row and the
 * transaction handle. A non-uuid or unknown org id is refused with the same message either
 * way (§5), and a non-uuid id never reaches the database at all.
 */
async function withLockedOrg(
  orgId: string,
  fn: (row: OrgRow, tx: Executor) => Promise<ActionResult>,
): Promise<ActionResult> {
  if (!isUuid(orgId)) return fail(UI.orgNoLongerExists);

  return db.transaction(async (tx) => {
    const row = await lockOrg(tx, orgId, {
      id: organizations.id,
      plan: organizations.plan,
      subscriptionStatus: organizations.subscriptionStatus,
      complimentary: organizations.complimentary,
      complimentaryUntil: organizations.complimentaryUntil,
      complimentaryPlan: organizations.complimentaryPlan,
      suspendedAt: organizations.suspendedAt,
    });
    if (!row) return fail(UI.orgNoLongerExists);

    // Read after the lock, so this is the copy the last writer holding it committed.
    const [billing] = await tx
      .select({ stripeStatus: orgBilling.stripeStatus })
      .from(orgBilling)
      .where(and(eq(orgBilling.orgId, orgId), sameStripeMode()));
    return fn({ ...row, stripeStatus: billing?.stripeStatus ?? null }, tx);
  });
}

/* -------------------------------------------------------------- change plan */

export async function changePlanAction(
  orgId: string,
  plan: string,
  status: string,
  note: string,
): Promise<ActionResult> {
  const staff = await requireStaff();
  if ("denied" in staff) return staff.denied;

  if (!isOrgPlan(plan)) return fail("That is not a valid plan.");
  if (!isSubscriptionStatus(status)) return fail("That is not a valid status.");

  const parsedNote = parseNote(note);
  if ("refusal" in parsedNote) return parsedNote.refusal;

  return withLockedOrg(orgId, async (row, tx) => {
    // Stripe is the one writer of plan/status while a subscription is live (P16); staff can act
    // again once it lapses.
    if (billingEnabled() && isLive(row.stripeStatus)) {
      return fail(UI.staffStripeManaged);
    }

    // Changing plan or status never touches suspension, complimentary access, or each other.
    // A save that changes nothing is refused rather than reported as saved: there is no event
    // action for "note only", so History would stay silent while the dialog said "updated".
    // A pinned free plan (`complimentary_plan`) that differs from the chosen one is a change:
    // it is what a complimentary org actually gets.
    if (row.plan === plan && row.subscriptionStatus === status && (row.complimentaryPlan ?? plan) === plan) {
      return fail(UI.accountNothingChanged);
    }

    const before = snapshot(row);
    // The plan staff choose is the plan the org gets: a free plan pinned at Checkout would
    // otherwise keep overriding it (P27).
    await tx
      .update(organizations)
      .set({ plan, subscriptionStatus: status, complimentaryPlan: null })
      .where(eq(organizations.id, orgId));
    const after = snapshot({ ...row, plan, subscriptionStatus: status });

    await tx.insert(orgAccountEvents).values({
      orgId,
      actorStaffId: staff.staffId,
      action: "plan_changed",
      before,
      after,
      note: parsedNote.value,
    });
    return ok();
  });
}

/* ------------------------------------------------------- complimentary access */

export async function setComplimentaryAction(
  orgId: string,
  enabled: boolean,
  until: string,
  note: string,
  cancelPaid: "now" | "period_end" | null = null,
): Promise<ActionResult> {
  const staff = await requireStaff();
  if ("denied" in staff) return staff.denied;

  const trimmedUntil = until.trim();
  if (trimmedUntil !== "" && !isValidIsoDate(trimmedUntil)) {
    return fail(UI.complimentaryUntilInvalid);
  }
  const untilValue = trimmedUntil === "" ? null : trimmedUntil;

  const parsedNote = parseNote(note);
  if ("refusal" in parsedNote) return parsedNote.refusal;

  // Stripe first and outside the row lock: the sync this triggers writes the same row, and a
  // Stripe failure then leaves nothing half done (§4.6). Granting free access to a paying org
  // ends the paid plan in the same step; changing the grant of an org that bought a plan during
  // free access moves that plan's first charge to follow it (`complimentaryStripeStep`).
  if (billingEnabled() && isUuid(orgId)) {
    // Whether it pays is Stripe's answer, not our copy's, which can be a webhook behind (a
    // Checkout finished a moment ago): re-sync first. Never throws; if Stripe can't be reached
    // the last copy decides.
    await refreshOrgBilling(orgId, "return");
    const [current] = await db
      .select({
        complimentary: organizations.complimentary,
        complimentaryUntil: organizations.complimentaryUntil,
        stripeStatus: orgBilling.stripeStatus,
      })
      .from(organizations)
      .leftJoin(orgBilling, billingCopyOn())
      .where(eq(organizations.id, orgId));
    const step = current ? complimentaryStripeStep(current, enabled, untilValue) : "none";
    if (step === "cancel" && cancelPaid !== "now" && cancelPaid !== "period_end") {
      return fail(UI.staffCompCancelRequired);
    }
    try {
      if (step === "cancel") await staffCancelSubscription(orgId, cancelPaid!);
      if (step === "move_first_charge") await staffMoveFirstCharge(orgId, enabled ? untilValue : null);
    } catch (e) {
      if (e instanceof BillingError && e.code === "change_pending") return fail(UI.staffCompChangeQueued);
      console.error(`[admin] updating org ${orgId}'s subscription for a complimentary change failed`, e);
      return fail(UI.billingStripeError);
    }
  }

  return withLockedOrg(orgId, async (row, tx) => {
    if (!enabled) {
      if (!row.complimentary) return fail(UI.accountNothingChanged); // already off
      const before = snapshot(row);
      // The pinned free plan (`complimentary_plan`) ends with the grant it belongs to.
      await tx
        .update(organizations)
        .set({ complimentary: false, complimentaryUntil: null, complimentaryPlan: null })
        .where(eq(organizations.id, orgId));
      const after = snapshot({ ...row, complimentary: false, complimentaryUntil: null });
      await tx.insert(orgAccountEvents).values({
        orgId,
        actorStaffId: staff.staffId,
        action: "complimentary_removed",
        before,
        after,
        note: parsedNote.value,
      });
      return ok();
    }

    if (!row.complimentary) {
      const before = snapshot(row);
      await tx
        .update(organizations)
        .set({ complimentary: true, complimentaryUntil: untilValue })
        .where(eq(organizations.id, orgId));
      const after = snapshot({ ...row, complimentary: true, complimentaryUntil: untilValue });
      await tx.insert(orgAccountEvents).values({
        orgId,
        actorStaffId: staff.staffId,
        action: "complimentary_granted",
        before,
        after,
        note: parsedNote.value,
      });
      return ok();
    }

    // Already on — only a genuinely different end date is a change.
    if (row.complimentaryUntil === untilValue) return fail(UI.accountNothingChanged);
    const before = snapshot(row);
    await tx
      .update(organizations)
      .set({ complimentaryUntil: untilValue })
      .where(eq(organizations.id, orgId));
    const after = snapshot({ ...row, complimentaryUntil: untilValue });
    await tx.insert(orgAccountEvents).values({
      orgId,
      actorStaffId: staff.staffId,
      action: "complimentary_changed",
      before,
      after,
      note: parsedNote.value,
    });
    return ok();
  });
}

/* ---------------------------------------------------------- suspend / reinstate */

export async function suspendOrgAction(orgId: string, reason: string): Promise<ActionResult> {
  const staff = await requireStaff();
  if ("denied" in staff) return staff.denied;

  const trimmed = reason.trim();
  if (!trimmed) return fail(UI.suspendReasonRequired);
  if (trimmed.length > ACCOUNT_NOTE_MAX_LENGTH) {
    return fail(UI.accountNoteTooLong(ACCOUNT_NOTE_MAX_LENGTH));
  }

  const result = await withLockedOrg(orgId, async (row, tx) => {
    if (row.suspendedAt !== null) return fail(UI.orgAlreadySuspended);

    const before = snapshot(row);
    const suspendedAt = new Date();
    await tx.update(organizations).set({ suspendedAt }).where(eq(organizations.id, orgId));

    // Signs every one of this org's users out immediately (§3.4). Only `sessions`, scoped to
    // this org's own users via a subquery — `staff_sessions` and every other org's rows are
    // untouched.
    await tx.delete(sessions).where(
      inArray(
        sessions.userId,
        tx.select({ id: users.id }).from(users).where(eq(users.orgId, orgId)),
      ),
    );

    const after = snapshot({ ...row, suspendedAt });
    await tx.insert(orgAccountEvents).values({
      orgId,
      actorStaffId: staff.staffId,
      action: "suspended",
      before,
      after,
      note: trimmed,
    });
    return ok();
  });

  // Outside the transaction, and never lets a Stripe failure undo a suspension that already
  // committed (D3): the org is suspended either way, the card is just left charging.
  if (result.ok) {
    try {
      await setCollectionPaused(orgId, true);
    } catch (e) {
      alert(`org ${orgId} suspended but its Stripe collection could not be paused; pause it by hand: ${e}`);
    }
  }
  return result;
}

export async function reinstateOrgAction(orgId: string, note: string): Promise<ActionResult> {
  const staff = await requireStaff();
  if ("denied" in staff) return staff.denied;

  const parsedNote = parseNote(note);
  if ("refusal" in parsedNote) return parsedNote.refusal;

  const result = await withLockedOrg(orgId, async (row, tx) => {
    if (row.suspendedAt === null) return fail(UI.orgNotSuspended);

    const before = snapshot(row);
    await tx.update(organizations).set({ suspendedAt: null }).where(eq(organizations.id, orgId));
    const after = snapshot({ ...row, suspendedAt: null });

    await tx.insert(orgAccountEvents).values({
      orgId,
      actorStaffId: staff.staffId,
      action: "reinstated",
      before,
      after,
      note: parsedNote.value,
    });
    return ok();
  });

  // Outside the transaction, same reasoning as suspend (D3): the reinstatement already
  // committed either way.
  if (result.ok) {
    try {
      await setCollectionPaused(orgId, false);
    } catch (e) {
      alert(`org ${orgId} reinstated but its Stripe collection could not be resumed; resume it by hand: ${e}`);
    }
  }
  return result;
}
