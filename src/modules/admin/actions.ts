"use server";

/**
 * AB Solutions staff account actions (Phase 9 §3.10, §5): change plan/status, turn
 * complimentary access on or off, suspend and reinstate. Every action locks the organisation
 * row first (`SELECT … FOR UPDATE`, D-98 decision 10) so two staff acting on one org at once
 * give one success and one refusal, then writes an `org_account_events` row in the same
 * transaction — no screens yet, so nothing here calls `revalidatePath`.
 */
import { eq, inArray } from "drizzle-orm";

import { db, type Database } from "@/src/db";
import {
  orgAccountEvents,
  organizations,
  orgPlan,
  sessions,
  subscriptionStatus,
  users,
  type OrgAccountSnapshot,
  type OrgPlan,
  type SubscriptionStatus,
} from "@/src/db/schema";
import { isValidIsoDate } from "@/src/domain/dates";
import { ACCOUNT_NOTE_MAX_LENGTH, UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { requireStaff } from "@/src/lib/action-session";
import { isUuid } from "@/src/lib/ids";

/** Either the pooled handle or an open transaction's — same trick as `funding-sources/queries.ts`. */
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

type OrgRow = {
  id: string;
  plan: OrgPlan;
  subscriptionStatus: SubscriptionStatus;
  complimentary: boolean;
  complimentaryUntil: string | null;
  suspendedAt: Date | null;
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
    const [row] = await tx
      .select({
        id: organizations.id,
        plan: organizations.plan,
        subscriptionStatus: organizations.subscriptionStatus,
        complimentary: organizations.complimentary,
        complimentaryUntil: organizations.complimentaryUntil,
        suspendedAt: organizations.suspendedAt,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for("update");

    if (!row) return fail(UI.orgNoLongerExists);
    return fn(row, tx);
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
    // Changing plan or status never touches suspension, complimentary access, or each other.
    if (row.plan === plan && row.subscriptionStatus === status) return ok();

    const before = snapshot(row);
    await tx
      .update(organizations)
      .set({ plan, subscriptionStatus: status })
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

  return withLockedOrg(orgId, async (row, tx) => {
    if (!enabled) {
      if (!row.complimentary) return ok(); // already off — no-op, no event
      const before = snapshot(row);
      await tx
        .update(organizations)
        .set({ complimentary: false, complimentaryUntil: null })
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
    if (row.complimentaryUntil === untilValue) return ok();
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

  return withLockedOrg(orgId, async (row, tx) => {
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
}

export async function reinstateOrgAction(orgId: string, note: string): Promise<ActionResult> {
  const staff = await requireStaff();
  if ("denied" in staff) return staff.denied;

  const parsedNote = parseNote(note);
  if ("refusal" in parsedNote) return parsedNote.refusal;

  return withLockedOrg(orgId, async (row, tx) => {
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
}
