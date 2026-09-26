/**
 * `createFundingSourceAction` / `updateFundingSourceAction` / `archiveFundingSourceAction` /
 * `unarchiveFundingSourceAction` against a real database (Phase 6, D-93, Phase 3).
 *
 * Admins and managers may both manage funding sources (Appendix A §1) â€” unlike most settings
 * actions, these do not call `requireAdmin()`, so a manager-role test is part of the contract
 * here, not incidental coverage. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// One mock for both: archive uses the any-plan session (D2), everything else the guarded one.
vi.mock("@/src/lib/action-session", () => {
  const session = vi.fn();
  return { actionSession: session, actionSessionAnyPlan: session };
});
// Stripe's answer to "is a downgrade to Reconciliation queued?" (P24). The rest of billing is real.
const queuedDowngradeMock = vi.fn();
vi.mock("@/src/modules/billing/billing", async () => ({
  ...(await vi.importActual<typeof import("@/src/modules/billing/billing")>("@/src/modules/billing/billing")),
  queuedDowngradeToReconciliation: (...args: unknown[]) => queuedDowngradeMock(...args),
}));

config({ path: ".env.local", quiet: true });

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { formatDateShort, todayIso } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("funding source management actions (integration)", async () => {
  const { db } = await import("@/src/db");
  const { fundingSources, organizations } = await import("@/src/db/schema");
  const { createTestOrg, setBillingCopy } = await import("@/src/db/test-org");
  const { actionSession } = await import("@/src/lib/action-session");
  const {
    archiveFundingSourceAction,
    createFundingSourceAction,
    unarchiveFundingSourceAction,
    updateFundingSourceAction,
  } = await import("./actions");
  const { findFundingSource, listFundingSources } = await import("./queries");
  const { loadFundingSourceLimit } = await import("./limit");

  const session = vi.mocked(actionSession);

  const createdOrgIds: string[] = [];
  afterAll(async () => {
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  async function org(name: string) {
    const created = await createTestOrg({ name });
    createdOrgIds.push(created.orgId);
    return created;
  }

  function asSession(orgId: string, role: "admin" | "manager" = "admin") {
    session.mockResolvedValue({
      orgId,
      userId: "u",
      email: "e@example.com",
      role,
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2026-02",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    });
  }

  const BASE_INPUT = {
    name: "Foundation Grant",
    type: "grant",
    docName: "",
    projectName: "",
    contractNumber: "",
    basePoNumber: "",
    performancePoNumber: "",
    contractValue: "0.00",
    contractStart: "",
    contractEnd: "",
    fiduciaryName: "",
    advancesReceived: "0.00",
    taxReimbursable: false,
    feesReimbursable: true,
  };

  beforeEach(() => {
    session.mockReset();
    queuedDowngradeMock.mockReset().mockResolvedValue(null);
  });

  it("creates a funding source on the happy path", async () => {
    const a = await org("Create Happy Path Org");
    asSession(a.orgId);

    const result = await createFundingSourceAction({ ...BASE_INPUT, name: "New Grant" });
    expect(result.ok).toBe(true);

    const rows = await db
      .select()
      .from(fundingSources)
      .where(eq(fundingSources.orgId, a.orgId));
    expect(rows.map((r) => r.name)).toContain("New Grant");
  });

  it("refuses a duplicate name, case-insensitively", async () => {
    const a = await org("Duplicate Name Org");
    asSession(a.orgId);

    const result = await createFundingSourceAction({ ...BASE_INPUT, name: "source 1" });
    expect(result.ok).toBe(false);
  });

  it("â˜… refuses to update a funding source belonging to another organisation", async () => {
    const a = await org("Owner Org For Update");
    const b = await org("Other Org For Update");
    asSession(a.orgId);

    const result = await updateFundingSourceAction({
      ...BASE_INPUT,
      id: b.fundingSourceId,
      name: "Hijacked",
    });
    expect(result.ok).toBe(false);

    // The other org's source is untouched.
    const untouched = await findFundingSource(b.orgId, b.fundingSourceId);
    expect(untouched?.name).not.toBe("Hijacked");
  });

  it("refuses to archive the last active funding source", async () => {
    const a = await org("Last Active Org");
    asSession(a.orgId);

    const result = await archiveFundingSourceAction(a.fundingSourceId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("at least one active");
  });

  it("archiving the organisation's active selection clears it, and unarchiving restores availability", async () => {
    const a = await org("Archive Clears Selection Org");
    const [second] = await db
      .insert(fundingSources)
      .values({
        orgId: a.orgId,
        name: "Second Source",
        type: "grant",
        sortOrder: 1,
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: fundingSources.id });

    await db
      .update(organizations)
      .set({ activeFundingSourceId: second.id })
      .where(eq(organizations.id, a.orgId));

    asSession(a.orgId);
    const result = await archiveFundingSourceAction(second.id);
    expect(result.ok).toBe(true);

    const [updatedOrg] = await db
      .select({ activeFundingSourceId: organizations.activeFundingSourceId })
      .from(organizations)
      .where(eq(organizations.id, a.orgId));
    expect(updatedOrg.activeFundingSourceId).toBeNull();

    const archived = await findFundingSource(a.orgId, second.id);
    expect(archived?.archivedAt).not.toBeNull();

    const unarchiveResult = await unarchiveFundingSourceAction(second.id);
    expect(unarchiveResult.ok).toBe(true);
    const restored = await findFundingSource(a.orgId, second.id);
    expect(restored?.archivedAt).toBeNull();
  });

  it("a manager, not just an admin, can create a funding source", async () => {
    const a = await org("Manager Create Org");
    asSession(a.orgId, "manager");

    const result = await createFundingSourceAction({ ...BASE_INPUT, name: "Manager's Grant" });
    expect(result.ok).toBe(true);
  });

  describe("money fields (review fix: blank vs unparseable)", () => {
    it("saves a blank contract value / advances received as 0", async () => {
      const a = await org("Blank Money Org");
      asSession(a.orgId);

      const result = await createFundingSourceAction({
        ...BASE_INPUT,
        name: "Blank Money Source",
        contractValue: "",
        advancesReceived: "   ",
      });
      expect(result.ok).toBe(true);

      const [row] = await db
        .select()
        .from(fundingSources)
        .where(and(eq(fundingSources.orgId, a.orgId), eq(fundingSources.name, "Blank Money Source")));
      expect(row.contractValueCents).toBe(0);
      expect(row.advancesReceivedCents).toBe(0);
    });

    it("refuses unparseable contract value text on create, and saves nothing", async () => {
      const a = await org("Bad Money Create Org");
      asSession(a.orgId);

      const before = await db
        .select({ id: fundingSources.id })
        .from(fundingSources)
        .where(eq(fundingSources.orgId, a.orgId));

      const result = await createFundingSourceAction({
        ...BASE_INPUT,
        name: "Bad Money Source",
        contractValue: "abc",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("valid contract value");

      const after = await db
        .select({ id: fundingSources.id })
        .from(fundingSources)
        .where(eq(fundingSources.orgId, a.orgId));
      expect(after).toHaveLength(before.length);
    });

    it("refuses unparseable advances-received text ('12x') on create", async () => {
      const a = await org("Bad Advances Org");
      asSession(a.orgId);

      const result = await createFundingSourceAction({
        ...BASE_INPUT,
        name: "Bad Advances Source",
        advancesReceived: "12x",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("valid advances received");
    });

    it("does not overwrite an existing non-zero contract value with garbage input on update", async () => {
      const a = await org("Preserve Contract Value Org");
      asSession(a.orgId);

      const created = await createFundingSourceAction({
        ...BASE_INPUT,
        name: "Real Grant",
        contractValue: "125000.00",
      });
      expect(created.ok).toBe(true);
      const [row] = await db
        .select()
        .from(fundingSources)
        .where(and(eq(fundingSources.orgId, a.orgId), eq(fundingSources.name, "Real Grant")));
      expect(row.contractValueCents).toBe(12_500_000);

      const updateResult = await updateFundingSourceAction({
        ...BASE_INPUT,
        id: row.id,
        name: "Real Grant",
        contractValue: "not-a-number",
      });
      expect(updateResult.ok).toBe(false);

      const [unchanged] = await db.select().from(fundingSources).where(eq(fundingSources.id, row.id));
      expect(unchanged.contractValueCents).toBe(12_500_000);
    });
  });

  describe("boolean rule flags (review fix)", () => {
    it("refuses a non-boolean taxReimbursable/feesReimbursable and saves nothing, without throwing", async () => {
      const a = await org("Bad Boolean Org");
      asSession(a.orgId);

      const before = await db
        .select({ id: fundingSources.id })
        .from(fundingSources)
        .where(eq(fundingSources.orgId, a.orgId));

      // Server actions are directly invocable, so a cast simulates a caller that skips the
      // client-side checkbox entirely â€” the string "true"/omitted value the DB column can't
      // accept as its NOT NULL boolean.
      const badInput = {
        ...BASE_INPUT,
        name: "Bad Boolean Source",
        taxReimbursable: "true",
        feesReimbursable: undefined,
      } as unknown as Parameters<typeof createFundingSourceAction>[0];

      let thrown: unknown = null;
      let result;
      try {
        result = await createFundingSourceAction(badInput);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeNull();
      expect(result?.ok).toBe(false);

      const after = await db
        .select({ id: fundingSources.id })
        .from(fundingSources)
        .where(eq(fundingSources.orgId, a.orgId));
      expect(after).toHaveLength(before.length);
    });

    it("refuses a non-boolean rule flag on update without overwriting the stored rules", async () => {
      const a = await org("Bad Boolean Update Org");
      asSession(a.orgId);

      const created = await createFundingSourceAction({
        ...BASE_INPUT,
        name: "Rules Source",
        taxReimbursable: true,
        feesReimbursable: false,
      });
      expect(created.ok).toBe(true);
      const [row] = await db
        .select()
        .from(fundingSources)
        .where(and(eq(fundingSources.orgId, a.orgId), eq(fundingSources.name, "Rules Source")));

      const badInput = {
        ...BASE_INPUT,
        id: row.id,
        name: "Rules Source",
        taxReimbursable: true,
        feesReimbursable: "yes",
      } as unknown as Parameters<typeof updateFundingSourceAction>[0];

      const result = await updateFundingSourceAction(badInput);
      expect(result.ok).toBe(false);

      const [unchanged] = await db.select().from(fundingSources).where(eq(fundingSources.id, row.id));
      expect(unchanged.taxReimbursable).toBe(true);
      expect(unchanged.feesReimbursable).toBe(false);
    });
  });

  describe("concurrent archive of the last two active sources (review fix, race)", () => {
    it("exactly one archive succeeds, the other is refused, and at least one source stays active â€” run repeatedly", async () => {
      for (let i = 0; i < 5; i++) {
        const a = await org(`Race Archive Org ${i}`);
        const [second] = await db
          .insert(fundingSources)
          .values({
            orgId: a.orgId,
            name: "Second Active Source",
            type: "grant",
            sortOrder: 1,
            taxReimbursable: false,
            feesReimbursable: true,
          })
          .returning({ id: fundingSources.id });

        asSession(a.orgId);

        const [r1, r2] = await Promise.all([
          archiveFundingSourceAction(a.fundingSourceId),
          archiveFundingSourceAction(second.id),
        ]);

        const results = [r1, r2];
        const succeeded = results.filter((r) => r.ok);
        const refused = results.filter((r) => !r.ok);
        expect(succeeded).toHaveLength(1);
        expect(refused).toHaveLength(1);
        if (!refused[0].ok) expect(refused[0].error).toContain("at least one active");

        const rows = await db
          .select({ archivedAt: fundingSources.archivedAt })
          .from(fundingSources)
          .where(eq(fundingSources.orgId, a.orgId));
        const activeCount = rows.filter((row) => row.archivedAt === null).length;
        expect(activeCount).toBeGreaterThanOrEqual(1);
        expect(activeCount).toBe(1); // exactly the one that lost the race stays active
      }
    });
  });

  describe("concurrent create with a duplicate name (review fix, race)", () => {
    it("both calls resolve without throwing; exactly one succeeds; exactly one row exists â€” run repeatedly", async () => {
      for (let i = 0; i < 20; i++) {
        const a = await org(`Race Duplicate Name Org ${i}`);
        asSession(a.orgId);

        const [r1, r2] = await Promise.all([
          createFundingSourceAction({ ...BASE_INPUT, name: "Racing Grant" }),
          createFundingSourceAction({ ...BASE_INPUT, name: "Racing Grant" }),
        ]);

        const results = [r1, r2];
        const succeeded = results.filter((r) => r.ok);
        const failed = results.filter((r) => !r.ok);
        expect(succeeded).toHaveLength(1);
        expect(failed).toHaveLength(1);
        if (!failed[0].ok) expect(failed[0].error).toBe("A funding source with that name already exists.");

        const rows = await db
          .select({ id: fundingSources.id })
          .from(fundingSources)
          .where(
            and(eq(fundingSources.orgId, a.orgId), sql`lower(${fundingSources.name}) = lower('Racing Grant')`),
          );
        expect(rows).toHaveLength(1);
      }
    });

    it("racing a rename onto an existing name: both resolve without throwing, name is never duplicated â€” run repeatedly", async () => {
      for (let i = 0; i < 20; i++) {
        const a = await org(`Race Rename Org ${i}`);
        asSession(a.orgId);

        // A second source to rename, plus the name it will collide with.
        const [target] = await db
          .insert(fundingSources)
          .values({
            orgId: a.orgId,
            name: "Rename Target",
            type: "grant",
            sortOrder: 1,
            taxReimbursable: false,
            feesReimbursable: true,
          })
          .returning({ id: fundingSources.id });

        // Two renames of two different sources onto the same new name, at once.
        const [r1, r2] = await Promise.all([
          updateFundingSourceAction({ ...BASE_INPUT, id: target.id, name: "Collision Name" }),
          updateFundingSourceAction({ ...BASE_INPUT, id: a.fundingSourceId, name: "Collision Name" }),
        ]);

        const results = [r1, r2];
        const succeeded = results.filter((r) => r.ok);
        expect(succeeded.length).toBeGreaterThanOrEqual(1); // at least one must land, neither call may throw

        const rows = await db
          .select({ id: fundingSources.id })
          .from(fundingSources)
          .where(
            and(eq(fundingSources.orgId, a.orgId), sql`lower(${fundingSources.name}) = lower('Collision Name')`),
          );
        // Whatever the outcome, the unique index guarantees the name is never duplicated.
        expect(rows.length).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("one active funding source limit on Reconciliation (Phase 16 Track C, C8, I-13)", () => {
    const originalBillingEnabled = process.env.BILLING_ENABLED;

    beforeEach(() => {
      process.env.BILLING_ENABLED = "true";
    });

    afterAll(() => {
      if (originalBillingEnabled === undefined) delete process.env.BILLING_ENABLED;
      else process.env.BILLING_ENABLED = originalBillingEnabled;
    });

    /** A paying, non-complimentary org on the given plan. */
    async function paidOrg(name: string, plan: "reconciliation" | "reconciliation_ai" = "reconciliation") {
      const created = await org(name);
      await db.update(organizations).set({ plan, complimentary: false }).where(eq(organizations.id, created.orgId));
      await setBillingCopy(created.orgId, { stripeStatus: "active" });
      return created;
    }

    async function activeCountOf(orgId: string) {
      const rows = await listFundingSources(orgId);
      return rows.filter((row) => row.archivedAt === null).length;
    }

    it("refuses create at the limit with the admin text, and inserts nothing", async () => {
      const a = await paidOrg("Limit Create Admin Org");
      asSession(a.orgId, "admin");

      const before = await listFundingSources(a.orgId);
      const result = await createFundingSourceAction({ ...BASE_INPUT, name: "Second Source" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(UI.fundingSourceLimitReached);

      const after = await listFundingSources(a.orgId);
      expect(after).toHaveLength(before.length);
    });

    it("refuses create at the limit with the manager text", async () => {
      const a = await paidOrg("Limit Create Manager Org");
      asSession(a.orgId, "manager");

      const result = await createFundingSourceAction({ ...BASE_INPUT, name: "Second Source" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(UI.fundingSourceLimitManager);
    });

    describe("a downgrade to Reconciliation already queued in Stripe (P24)", () => {
      const startsAt = new Date("2026-11-01T16:00:00Z");

      it("refuses a second source on Reconciliation + AI, saying when the switch happens", async () => {
        const a = await paidOrg("Queued Downgrade Create Org", "reconciliation_ai");
        queuedDowngradeMock.mockResolvedValue(startsAt);
        asSession(a.orgId, "admin");
        const before = await listFundingSources(a.orgId);

        const result = await createFundingSourceAction({ ...BASE_INPUT, name: "Second Source" });
        expect(queuedDowngradeMock).toHaveBeenCalledWith(a.orgId);
        expect(result).toEqual({ ok: false, error: UI.fundingSourceLimitQueued(formatDateShort(todayIso(startsAt))) });
        expect(await listFundingSources(a.orgId)).toHaveLength(before.length);
      });

      it("refuses unarchiving one too, and it stays archived", async () => {
        const a = await paidOrg("Queued Downgrade Unarchive Org", "reconciliation_ai");
        const [second] = await db
          .insert(fundingSources)
          .values({
            orgId: a.orgId,
            name: "Second Source",
            type: "grant",
            sortOrder: 1,
            archivedAt: new Date(),
            taxReimbursable: false,
            feesReimbursable: true,
          })
          .returning({ id: fundingSources.id });
        queuedDowngradeMock.mockResolvedValue(startsAt);
        asSession(a.orgId, "admin");

        const result = await unarchiveFundingSourceAction(second.id);
        expect(result).toEqual({ ok: false, error: UI.fundingSourceLimitQueued(formatDateShort(todayIso(startsAt))) });
        expect((await findFundingSource(a.orgId, second.id))?.archivedAt).not.toBeNull();
      });

      it("with nothing queued, Reconciliation + AI still adds sources freely", async () => {
        const a = await paidOrg("Nothing Queued Org", "reconciliation_ai");
        asSession(a.orgId, "admin");
        expect(await createFundingSourceAction({ ...BASE_INPUT, name: "Second Source" })).toMatchObject({ ok: true });
      });

      it("when Stripe can't be asked, nothing is saved and the admin is told to try again", async () => {
        const a = await paidOrg("Stripe Down Org", "reconciliation_ai");
        queuedDowngradeMock.mockRejectedValue(new Error("stripe is down"));
        asSession(a.orgId, "admin");
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(await createFundingSourceAction({ ...BASE_INPUT, name: "Second Source" })).toEqual({
          ok: false,
          error: UI.fundingSourceStripeUnavailable,
        });
        errorSpy.mockRestore();
      });
    });

    it("refuses unarchive at the limit, and the row stays archived", async () => {
      const a = await paidOrg("Limit Unarchive Org");
      const [second] = await db
        .insert(fundingSources)
        .values({
          orgId: a.orgId,
          name: "Second Source",
          type: "grant",
          sortOrder: 1,
          archivedAt: new Date(),
          taxReimbursable: false,
          feesReimbursable: true,
        })
        .returning({ id: fundingSources.id });

      asSession(a.orgId);
      const result = await unarchiveFundingSourceAction(second.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(UI.fundingSourceLimitReached);

      const row = await findFundingSource(a.orgId, second.id);
      expect(row?.archivedAt).not.toBeNull();
    });

    it("allows unarchive once the only other active source is archived first (activeOthers 0)", async () => {
      const a = await paidOrg("Limit Unarchive Freed Org");
      const [second] = await db
        .insert(fundingSources)
        .values({
          orgId: a.orgId,
          name: "Second Source",
          type: "grant",
          sortOrder: 1,
          archivedAt: new Date(),
          taxReimbursable: false,
          feesReimbursable: true,
        })
        .returning({ id: fundingSources.id });

      // The org's own seed source is the only other active one; archiving it directly (not
      // through the action, which refuses to archive the last active source) is the setup step
      // that produces activeOthers 0 for the unarchive under test.
      await db
        .update(fundingSources)
        .set({ archivedAt: new Date() })
        .where(eq(fundingSources.id, a.fundingSourceId));

      asSession(a.orgId);
      const unarchiveResult = await unarchiveFundingSourceAction(second.id);
      expect(unarchiveResult.ok).toBe(true);
      const row = await findFundingSource(a.orgId, second.id);
      expect(row?.archivedAt).toBeNull();
    });

    it("unarchiving an already-active source at the limit is a no-op ok", async () => {
      const a = await paidOrg("Limit Unarchive Noop Org");
      asSession(a.orgId);

      const result = await unarchiveFundingSourceAction(a.fundingSourceId);
      expect(result.ok).toBe(true);
      const row = await findFundingSource(a.orgId, a.fundingSourceId);
      expect(row?.archivedAt).toBeNull();
    });

    it("an org somehow already over the limit (2 active on Reconciliation) refuses a third create and any unarchive", async () => {
      const a = await paidOrg("Over Limit Org");
      const [second] = await db
        .insert(fundingSources)
        .values({
          orgId: a.orgId,
          name: "Second Active Source",
          type: "grant",
          sortOrder: 1,
          taxReimbursable: false,
          feesReimbursable: true,
        })
        .returning({ id: fundingSources.id });
      const [third] = await db
        .insert(fundingSources)
        .values({
          orgId: a.orgId,
          name: "Third Source",
          type: "grant",
          sortOrder: 2,
          archivedAt: new Date(),
          taxReimbursable: false,
          feesReimbursable: true,
        })
        .returning({ id: fundingSources.id });
      expect(second.id).toBeTruthy();

      asSession(a.orgId);
      const createResult = await createFundingSourceAction({ ...BASE_INPUT, name: "Fourth Source" });
      expect(createResult.ok).toBe(false);

      const unarchiveResult = await unarchiveFundingSourceAction(third.id);
      expect(unarchiveResult.ok).toBe(false);
    });

    it("concurrency: 5 concurrent creates from 0 active sources leave exactly one active row, run repeatedly", async () => {
      // Repeated across fresh orgs (same discipline as this file's other race tests, above):
      // a single trial does not reliably catch a missing lock on a fast local database, where
      // five transactions can pipeline through the pool without ever truly overlapping.
      for (let i = 0; i < 10; i++) {
        const a = await paidOrg(`Concurrent Create Org ${i}`);
        // Start from 0 active: archive the seed source directly (no admin lock contention in setup).
        await db
          .update(fundingSources)
          .set({ archivedAt: new Date() })
          .where(eq(fundingSources.id, a.fundingSourceId));

        asSession(a.orgId);
        const names = ["Race A", "Race B", "Race C", "Race D", "Race E"];
        const results = await Promise.all(
          names.map((name) => createFundingSourceAction({ ...BASE_INPUT, name })),
        );

        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok)).toHaveLength(4);
        expect(await activeCountOf(a.orgId)).toBe(1);
      }
    });

    it("concurrency: 5 concurrent unarchives of 5 archived sources leave exactly one active, run repeatedly", async () => {
      for (let i = 0; i < 10; i++) {
        const a = await paidOrg(`Concurrent Unarchive Org ${i}`);
        await db
          .update(fundingSources)
          .set({ archivedAt: new Date() })
          .where(eq(fundingSources.id, a.fundingSourceId));

        const inserted = await db
          .insert(fundingSources)
          .values(
            ["Archived A", "Archived B", "Archived C", "Archived D"].map((name, j) => ({
              orgId: a.orgId,
              name,
              type: "grant" as const,
              sortOrder: j + 1,
              archivedAt: new Date(),
              taxReimbursable: false,
              feesReimbursable: true,
            })),
          )
          .returning({ id: fundingSources.id });

        const ids = [a.fundingSourceId, ...inserted.map((row) => row.id)];
        expect(ids).toHaveLength(5);

        asSession(a.orgId);
        const results = await Promise.all(ids.map((id) => unarchiveFundingSourceAction(id)));

        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok)).toHaveLength(4);
        expect(await activeCountOf(a.orgId)).toBe(1);
      }
    });

    it("Reconciliation + AI paid: several creates and unarchives all succeed", async () => {
      const a = await paidOrg("Unlimited Plan Org", "reconciliation_ai");
      asSession(a.orgId);

      for (const name of ["Extra 1", "Extra 2", "Extra 3"]) {
        const result = await createFundingSourceAction({ ...BASE_INPUT, name });
        expect(result.ok).toBe(true);
      }

      const [toArchive] = await listFundingSources(a.orgId);
      await archiveFundingSourceAction(toArchive.id);
      const unarchiveResult = await unarchiveFundingSourceAction(toArchive.id);
      expect(unarchiveResult.ok).toBe(true);

      expect(await activeCountOf(a.orgId)).toBe(4);
    });

    it("complimentary org on the reconciliation complimentary_plan is limited", async () => {
      const a = await org("Complimentary Reconciliation Org");
      await db
        .update(organizations)
        .set({ complimentary: true, complimentaryUntil: null, complimentaryPlan: "reconciliation" })
        .where(eq(organizations.id, a.orgId));

      asSession(a.orgId);
      const result = await createFundingSourceAction({ ...BASE_INPUT, name: "Second Source" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(UI.fundingSourceLimitReached);
    });

    it("complimentary org on the reconciliation_ai complimentary_plan is unlimited", async () => {
      const a = await org("Complimentary Reconciliation AI Org");
      await db
        .update(organizations)
        .set({ complimentary: true, complimentaryUntil: null, complimentaryPlan: "reconciliation_ai" })
        .where(eq(organizations.id, a.orgId));

      asSession(a.orgId);
      const result = await createFundingSourceAction({ ...BASE_INPUT, name: "Second Source" });
      expect(result.ok).toBe(true);
    });

    it("billing off: a Reconciliation org can still create and unarchive past 1 (today's behaviour)", async () => {
      process.env.BILLING_ENABLED = "false";
      const a = await paidOrg("Billing Off Org");
      asSession(a.orgId);

      const createResult = await createFundingSourceAction({ ...BASE_INPUT, name: "Second Source" });
      expect(createResult.ok).toBe(true);

      const [second] = await db
        .insert(fundingSources)
        .values({
          orgId: a.orgId,
          name: "Third Source",
          type: "grant",
          sortOrder: 2,
          archivedAt: new Date(),
          taxReimbursable: false,
          feesReimbursable: true,
        })
        .returning({ id: fundingSources.id });
      const unarchiveResult = await unarchiveFundingSourceAction(second.id);
      expect(unarchiveResult.ok).toBe(true);
    });

    describe("loadFundingSourceLimit", () => {
      it("is null when billing is off", async () => {
        process.env.BILLING_ENABLED = "false";
        const a = await paidOrg("Load Limit Billing Off Org");
        expect(await loadFundingSourceLimit(a.orgId)).toBeNull();
      });

      it("is 1 for a paid Reconciliation org", async () => {
        const a = await paidOrg("Load Limit Reconciliation Org");
        expect(await loadFundingSourceLimit(a.orgId)).toBe(1);
      });

      it("is null for a paid Reconciliation + AI org", async () => {
        const a = await paidOrg("Load Limit Reconciliation AI Org", "reconciliation_ai");
        expect(await loadFundingSourceLimit(a.orgId)).toBeNull();
      });
    });
  });
});
