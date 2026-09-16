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
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("funding source management actions (integration)", async () => {
  const { db } = await import("@/src/db");
  const { fundingSources, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { actionSession } = await import("@/src/lib/action-session");
  const {
    archiveFundingSourceAction,
    createFundingSourceAction,
    unarchiveFundingSourceAction,
    updateFundingSourceAction,
  } = await import("./actions");
  const { findFundingSource } = await import("./queries");

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
});
