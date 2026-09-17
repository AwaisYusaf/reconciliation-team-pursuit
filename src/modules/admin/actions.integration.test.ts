/**
 * AB Solutions staff account actions (Phase 9 part 2, `docs/PHASE-9.md` §8 "Phase 2"):
 * `changePlanAction`, `setComplimentaryAction`, `suspendOrgAction`, `reinstateOrgAction`.
 *
 * `requireStaff` is mocked the same way the sibling integration suites mock `actionSession` —
 * these tests are about the four actions' own validation, locking and event-logging, not about
 * the staff cookie/session plumbing (that lives in `action-session.staff.integration.test.ts`
 * and, for the suspension interaction specifically, `suspension-session.integration.test.ts`).
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("@/src/lib/action-session", () => ({
  requireStaff: vi.fn(),
  FORBIDDEN: "You do not have permission to do that.",
}));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("admin account actions (integration, Phase 9 part 2)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, orgAccountEvents, staffUsers } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { UI, ACCOUNT_NOTE_MAX_LENGTH } = await import("@/src/domain/strings");
  const { fail } = await import("@/src/lib/action-result");
  const { FORBIDDEN } = await import("@/src/lib/action-session");
  const { SESSION_EXPIRED } = await import("@/src/lib/action-result");
  const { requireStaff } = await import("@/src/lib/action-session");

  const {
    changePlanAction,
    setComplimentaryAction,
    suspendOrgAction,
    reinstateOrgAction,
  } = await import("./actions");

  const requireStaffMock = vi.mocked(requireStaff);

  let staffId: string;
  const orgIds: string[] = [];

  function asStaff() {
    requireStaffMock.mockResolvedValue({ staffId, email: "staff@example.test", name: "Staff" });
  }
  function asDenied(error: string) {
    requireStaffMock.mockResolvedValue({ denied: fail(error) });
  }

  async function freshOrg() {
    const org = await createTestOrg({ name: `Admin Actions Org ${Date.now()}-${Math.random()}` });
    orgIds.push(org.orgId);
    return org.orgId;
  }

  async function eventsFor(orgId: string) {
    return db
      .select()
      .from(orgAccountEvents)
      .where(eq(orgAccountEvents.orgId, orgId))
      .orderBy(orgAccountEvents.createdAt);
  }

  async function orgRow(orgId: string) {
    const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    return row;
  }

  beforeAll(async () => {
    const [staff] = await db
      .insert(staffUsers)
      .values({
        email: `admin-actions-staff-${Date.now()}@example.test`,
        name: "Admin Actions Staff",
        passwordHash: await hashPassword("irrelevant-password-1"),
      })
      .returning({ id: staffUsers.id });
    staffId = staff.id;
  });

  afterAll(async () => {
    for (const id of orgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
    if (staffId) await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
  });

  /* --------------------------------------------------------- org id validation */

  it("unknown (valid-uuid-but-absent) org id and a non-uuid org id refuse with orgNoLongerExists on all four actions", async () => {
    asStaff();
    const absentId = "00000000-0000-7000-8000-000000000000";
    const notUuid = "not-a-uuid";

    for (const badId of [absentId, notUuid]) {
      expect(await changePlanAction(badId, "reconciliation", "trial", "")).toEqual(
        fail(UI.orgNoLongerExists),
      );
      expect(await setComplimentaryAction(badId, true, "", "")).toEqual(fail(UI.orgNoLongerExists));
      expect(await suspendOrgAction(badId, "reason")).toEqual(fail(UI.orgNoLongerExists));
      expect(await reinstateOrgAction(badId, "")).toEqual(fail(UI.orgNoLongerExists));
    }
  });

  /* ---------------------------------------------------------------- change plan */

  it("invalid plan and invalid status values are refused before touching the org", async () => {
    asStaff();
    const orgId = await freshOrg();
    expect(await changePlanAction(orgId, "not-a-plan", "trial", "")).toEqual(
      fail("That is not a valid plan."),
    );
    expect(await changePlanAction(orgId, "reconciliation", "not-a-status", "")).toEqual(
      fail("That is not a valid status."),
    );
    expect(await eventsFor(orgId)).toHaveLength(0);
  });

  it("changePlanAction on a suspended org leaves suspended_at set and unchanged, and never touches complimentary", async () => {
    asStaff();
    const orgId = await freshOrg();
    const suspend = await suspendOrgAction(orgId, "for the test");
    expect(suspend.ok).toBe(true);
    const beforeChange = await orgRow(orgId);
    expect(beforeChange.suspendedAt).not.toBeNull();

    const result = await changePlanAction(orgId, "reconciliation_ai", "active", "plan bump");
    expect(result.ok).toBe(true);

    const after = await orgRow(orgId);
    expect(after.suspendedAt!.getTime()).toBe(beforeChange.suspendedAt!.getTime());
    expect(after.complimentary).toBe(false);
    expect(after.plan).toBe("reconciliation_ai");
    expect(after.subscriptionStatus).toBe("active");
  });

  /* -------------------------------------------------------------- complimentary */

  it("invalid until is refused; empty/whitespace until is accepted as null", async () => {
    asStaff();
    const orgId = await freshOrg();

    expect(await setComplimentaryAction(orgId, true, "2026-13-40", "")).toEqual(
      fail(UI.complimentaryUntilInvalid),
    );
    expect(await setComplimentaryAction(orgId, true, "not-a-date", "")).toEqual(
      fail(UI.complimentaryUntilInvalid),
    );

    const result = await setComplimentaryAction(orgId, true, "   ", "note");
    expect(result.ok).toBe(true);
    const after = await orgRow(orgId);
    expect(after.complimentary).toBe(true);
    expect(after.complimentaryUntil).toBeNull();
  });

  /* --------------------------------------------------------------------- notes */

  it("empty and whitespace-only suspend reasons are refused", async () => {
    asStaff();
    const orgId = await freshOrg();
    expect(await suspendOrgAction(orgId, "")).toEqual(fail(UI.suspendReasonRequired));
    expect(await suspendOrgAction(orgId, "   ")).toEqual(fail(UI.suspendReasonRequired));
    const row = await orgRow(orgId);
    expect(row.suspendedAt).toBeNull();
  });

  it("a 701-character note is refused on all four actions that take one; a 700-character note is accepted", async () => {
    asStaff();
    const orgId = await freshOrg();
    const tooLong = "x".repeat(ACCOUNT_NOTE_MAX_LENGTH + 1);
    const exact = "y".repeat(ACCOUNT_NOTE_MAX_LENGTH);

    expect(await changePlanAction(orgId, "reconciliation", "trial", tooLong)).toEqual(
      fail(UI.accountNoteTooLong(ACCOUNT_NOTE_MAX_LENGTH)),
    );
    expect(await setComplimentaryAction(orgId, true, "", tooLong)).toEqual(
      fail(UI.accountNoteTooLong(ACCOUNT_NOTE_MAX_LENGTH)),
    );
    expect(await suspendOrgAction(orgId, tooLong)).toEqual(
      fail(UI.accountNoteTooLong(ACCOUNT_NOTE_MAX_LENGTH)),
    );
    // reinstateOrgAction: refused for a too-long note even though the org isn't suspended yet —
    // note length is checked before the org lock, same order as the other three actions.
    expect(await reinstateOrgAction(orgId, tooLong)).toEqual(
      fail(UI.accountNoteTooLong(ACCOUNT_NOTE_MAX_LENGTH)),
    );

    // Exact length accepted on changePlanAction — a genuine plan change so the note is actually stored.
    const changed = await changePlanAction(orgId, "reconciliation_ai", "trial", exact);
    expect(changed.ok).toBe(true);
    const events = await eventsFor(orgId);
    expect(events.find((e) => e.action === "plan_changed")?.note).toBe(exact);
  });

  /* --------------------------------------------------------- suspend / reinstate */

  it("double suspend: second call returns orgAlreadySuspended; reinstate on a non-suspended org returns orgNotSuspended", async () => {
    asStaff();
    const orgId = await freshOrg();
    const first = await suspendOrgAction(orgId, "first suspend");
    expect(first.ok).toBe(true);
    const second = await suspendOrgAction(orgId, "second suspend");
    expect(second).toEqual(fail(UI.orgAlreadySuspended));

    const otherOrgId = await freshOrg();
    const reinstateNotSuspended = await reinstateOrgAction(otherOrgId, "");
    expect(reinstateNotSuspended).toEqual(fail(UI.orgNotSuspended));
  });

  it("waits on a row lock another transaction holds, and sees that transaction's write once it commits", async () => {
    asStaff();
    const orgId = await freshOrg();

    // The previous version of this test fired two suspends with Promise.all and checked that
    // one won — which passes with or without `FOR UPDATE`, because two pooled statements
    // usually serialise anyway. This holds the org row locked in a real second transaction,
    // the way `lock-guard.integration.test.ts` does, so the action can only proceed by taking
    // the same lock. Remove `.for("update")` in `withLockedOrg` and this fails: the action
    // reads the pre-suspend row, waits only on the UPDATE, and suspends an org that was
    // already suspended underneath it — two 'suspended' events for one suspension.
    let releaseLock: () => void;
    const holdUntilReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let lockTaken = false;

    const lockTxPromise = db.transaction(async (tx) => {
      await tx.select().from(organizations).where(eq(organizations.id, orgId)).for("update");
      await tx
        .update(organizations)
        .set({ suspendedAt: new Date() })
        .where(eq(organizations.id, orgId));
      lockTaken = true;
      await holdUntilReleased;
    });

    while (!lockTaken) await new Promise((r) => setTimeout(r, 5));

    let settled = false;
    const suspendPromise = suspendOrgAction(orgId, "waited for the lock").then((result) => {
      settled = true;
      return result;
    });

    // Still pending: the action's own SELECT … FOR UPDATE cannot read the row while the other
    // transaction holds it.
    await new Promise((r) => setTimeout(r, 200));
    expect(settled).toBe(false);

    releaseLock!();
    await lockTxPromise;

    // Once the lock is released the action reads the committed row and refuses, rather than
    // suspending an already-suspended organization.
    expect(await suspendPromise).toEqual(fail(UI.orgAlreadySuspended));
    const events = await eventsFor(orgId);
    expect(events.filter((e) => e.action === "suspended")).toHaveLength(0);
  }, 20_000);

  it("concurrent suspends: exactly one ok, one orgAlreadySuspended, and exactly one 'suspended' event row", async () => {
    asStaff();
    const orgId = await freshOrg();

    const [a, b] = await Promise.all([
      suspendOrgAction(orgId, "race A"),
      suspendOrgAction(orgId, "race B"),
    ]);
    const results = [a, b];
    const okCount = results.filter((r) => r.ok).length;
    const alreadyCount = results.filter((r) => !r.ok && r.error === UI.orgAlreadySuspended).length;
    expect(okCount).toBe(1);
    expect(alreadyCount).toBe(1);

    const events = await eventsFor(orgId);
    expect(events.filter((e) => e.action === "suspended")).toHaveLength(1);
  });

  /* ------------------------------------------------------------------- no-ops */

  it("a save that changes nothing is refused rather than reported as saved, and writes no event — even with a note", async () => {
    asStaff();
    const orgId = await freshOrg();

    // A note on its own has nowhere to go: there is no "note only" event action, so History
    // would stay empty while the dialog said "updated". The staff member is told instead.
    // Fresh org starts plan=reconciliation, status=trial (schema defaults).
    expect(await changePlanAction(orgId, "reconciliation", "trial", "just a note")).toEqual(
      fail(UI.accountNothingChanged),
    );
    expect(await eventsFor(orgId)).toHaveLength(0);

    // Complimentary already off, disabling again.
    expect(await setComplimentaryAction(orgId, false, "", "just a note")).toEqual(
      fail(UI.accountNothingChanged),
    );
    expect(await eventsFor(orgId)).toHaveLength(0);

    // Turn it on for real, then set it on again with the same end date.
    expect((await setComplimentaryAction(orgId, true, "2027-01-01", "grant it")).ok).toBe(true);
    expect(await eventsFor(orgId)).toHaveLength(1);

    expect(await setComplimentaryAction(orgId, true, "2027-01-01", "just a note")).toEqual(
      fail(UI.accountNothingChanged),
    );
    expect(await eventsFor(orgId)).toHaveLength(1); // unchanged — still just the grant

    // Nothing on the row moved through any of it.
    const row = await orgRow(orgId);
    expect(row.plan).toBe("reconciliation");
    expect(row.subscriptionStatus).toBe("trial");
    expect(row.complimentary).toBe(true);
    expect(row.complimentaryUntil).toBe("2027-01-01");
  });

  it("changing the end date writes complimentary_changed; turning it off writes complimentary_removed and clears the date", async () => {
    asStaff();
    const orgId = await freshOrg();

    expect((await setComplimentaryAction(orgId, true, "2027-01-01", "pilot")).ok).toBe(true);
    expect((await setComplimentaryAction(orgId, true, "2027-06-30", "extended")).ok).toBe(true);

    let events = await eventsFor(orgId);
    const changed = events.find((e) => e.action === "complimentary_changed")!;
    expect(changed.before.complimentaryUntil).toBe("2027-01-01");
    expect(changed.after.complimentaryUntil).toBe("2027-06-30");
    expect(changed.before.complimentary).toBe(true);
    expect(changed.after.complimentary).toBe(true);
    expect(changed.note).toBe("extended");

    expect((await setComplimentaryAction(orgId, false, "", "over")).ok).toBe(true);

    events = await eventsFor(orgId);
    const removed = events.find((e) => e.action === "complimentary_removed")!;
    expect(removed.before.complimentary).toBe(true);
    expect(removed.after.complimentary).toBe(false);
    expect(removed.after.complimentaryUntil).toBeNull();

    const row = await orgRow(orgId);
    expect(row.complimentary).toBe(false);
    expect(row.complimentaryUntil).toBeNull();
  });

  /* ---------------------------------------------------------------- event rows */

  it("every event row carries the right actorStaffId, action, before/after snapshots with the flipped fields, and a trimmed note (empty stored as null)", async () => {
    asStaff();
    const orgId = await freshOrg();

    const changed = await changePlanAction(orgId, "reconciliation_ai", "active", "  a note  ");
    expect(changed.ok).toBe(true);

    let events = await eventsFor(orgId);
    expect(events).toHaveLength(1);
    expect(events[0].actorStaffId).toBe(staffId);
    expect(events[0].action).toBe("plan_changed");
    expect(events[0].before).toEqual({
      plan: "reconciliation",
      status: "trial",
      complimentary: false,
      complimentaryUntil: null,
      suspended: false,
    });
    expect(events[0].after).toEqual({
      plan: "reconciliation_ai",
      status: "active",
      complimentary: false,
      complimentaryUntil: null,
      suspended: false,
    });
    expect(events[0].note).toBe("a note");

    // Empty note (whitespace-only) is stored null, not empty string.
    const suspend = await suspendOrgAction(orgId, "must suspend");
    expect(suspend.ok).toBe(true);
    const reinstate = await reinstateOrgAction(orgId, "   ");
    expect(reinstate.ok).toBe(true);

    events = await eventsFor(orgId);
    const reinstateEvent = events.find((e) => e.action === "reinstated")!;
    expect(reinstateEvent.note).toBeNull();
    expect(reinstateEvent.before.suspended).toBe(true);
    expect(reinstateEvent.after.suspended).toBe(false);

    const suspendEvent = events.find((e) => e.action === "suspended")!;
    expect(suspendEvent.note).toBe("must suspend"); // suspend's reason is required, never null
    expect(suspendEvent.before.suspended).toBe(false);
    expect(suspendEvent.after.suspended).toBe(true);
  });

  /* --------------------------------------------------------------- requireStaff */

  it("requireStaff denial: a customer session and a signed-out caller get the typed denial from all four actions, and nothing is written", async () => {
    const orgId = await freshOrg();

    asDenied(FORBIDDEN);
    expect(await changePlanAction(orgId, "reconciliation_ai", "active", "")).toEqual(fail(FORBIDDEN));
    expect(await setComplimentaryAction(orgId, true, "", "")).toEqual(fail(FORBIDDEN));
    expect(await suspendOrgAction(orgId, "reason")).toEqual(fail(FORBIDDEN));
    expect(await reinstateOrgAction(orgId, "")).toEqual(fail(FORBIDDEN));

    asDenied(SESSION_EXPIRED);
    expect(await changePlanAction(orgId, "reconciliation_ai", "active", "")).toEqual(
      fail(SESSION_EXPIRED),
    );
    expect(await setComplimentaryAction(orgId, true, "", "")).toEqual(fail(SESSION_EXPIRED));
    expect(await suspendOrgAction(orgId, "reason")).toEqual(fail(SESSION_EXPIRED));
    expect(await reinstateOrgAction(orgId, "")).toEqual(fail(SESSION_EXPIRED));

    expect(await eventsFor(orgId)).toHaveLength(0);
    const row = await orgRow(orgId);
    expect(row.plan).toBe("reconciliation");
    expect(row.suspendedAt).toBeNull();
  });
});
