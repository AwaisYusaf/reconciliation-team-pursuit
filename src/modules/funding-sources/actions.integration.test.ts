/**
 * `createFundingSourceAction` / `updateFundingSourceAction` / `archiveFundingSourceAction` /
 * `unarchiveFundingSourceAction` against a real database (Phase 6, D-93, Phase 3).
 *
 * Admins and managers may both manage funding sources (Appendix A §1) — unlike most settings
 * actions, these do not call `requireAdmin()`, so a manager-role test is part of the contract
 * here, not incidental coverage. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
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

  it("★ refuses to update a funding source belonging to another organisation", async () => {
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
});
