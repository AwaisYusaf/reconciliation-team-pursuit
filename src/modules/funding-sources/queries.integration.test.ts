/**
 * `loadSourceContext`, `findFundingSource` and `requireOwnedFundingSource` (Phase 6, D-93).
 *
 * The selection rules in `loadSourceContext` are the one place that decides what "All" means
 * and when a stored choice is honoured — every page and download route trusts this instead of
 * re-deriving the rules itself (decision 2.13), so its edge cases matter more than the size of
 * the function suggests.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("funding source context and ownership (integration)", async () => {
  const { db } = await import("@/src/db");
  const { fundingSources, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { findFundingSource, loadSourceContext, requireOwnedFundingSource } = await import(
    "./queries"
  );

  const createdOrgIds: string[] = [];
  afterAll(async () => {
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  async function org(overrides: Parameters<typeof createTestOrg>[0] = {}) {
    const created = await createTestOrg(overrides);
    createdOrgIds.push(created.orgId);
    return created;
  }

  it("a single-source organisation always has that source selected", async () => {
    const a = await org({ name: "Single Source Org" });
    const context = await loadSourceContext(a.orgId, null);
    expect(context.single).toBe(true);
    expect(context.selectedId).toBe(a.fundingSourceId);
    expect(context.sources.map((s) => s.id)).toEqual([a.fundingSourceId]);
  });

  it("a multi-source organisation with a valid stored id keeps that selection", async () => {
    const a = await org({ name: "Multi Source Org A" });
    const [second] = await db
      .insert(fundingSources)
      .values({
        orgId: a.orgId,
        name: "Source 2",
        type: "grant",
        sortOrder: 1,
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: fundingSources.id });

    const context = await loadSourceContext(a.orgId, second.id);
    expect(context.single).toBe(false);
    expect(context.selectedId).toBe(second.id);
  });

  it("a stored id that does not belong to this organisation falls back to All", async () => {
    const a = await org({ name: "Multi Source Org B" });
    await db.insert(fundingSources).values({
      orgId: a.orgId,
      name: "Source 2",
      type: "grant",
      sortOrder: 1,
      taxReimbursable: false,
      feesReimbursable: true,
    });
    const other = await org({ name: "Unrelated Org" });

    const context = await loadSourceContext(a.orgId, other.fundingSourceId);
    expect(context.selectedId).toBeNull();
  });

  it("a stored archived id stays selected, for viewing its history", async () => {
    const a = await org({ name: "Multi Source Org C" });
    const [second] = await db
      .insert(fundingSources)
      .values({
        orgId: a.orgId,
        name: "Wound-down grant",
        type: "grant",
        sortOrder: 1,
        taxReimbursable: false,
        feesReimbursable: true,
        archivedAt: new Date(),
      })
      .returning({ id: fundingSources.id });

    const context = await loadSourceContext(a.orgId, second.id);
    expect(context.selectedId).toBe(second.id);
    expect(context.activeSources.map((s) => s.id)).not.toContain(second.id);
    expect(context.sources.map((s) => s.id)).toContain(second.id);
  });

  it("no stored id in a multi-source organisation means All", async () => {
    const a = await org({ name: "Multi Source Org D" });
    await db.insert(fundingSources).values({
      orgId: a.orgId,
      name: "Source 2",
      type: "grant",
      sortOrder: 1,
      taxReimbursable: false,
      feesReimbursable: true,
    });

    const context = await loadSourceContext(a.orgId, null);
    expect(context.selectedId).toBeNull();
  });

  it("findFundingSource refuses a source that belongs to another organisation", async () => {
    const a = await org({ name: "Owner Org" });
    const b = await org({ name: "Stranger Org" });

    expect(await findFundingSource(a.orgId, b.fundingSourceId)).toBeNull();
    const found = await findFundingSource(a.orgId, a.fundingSourceId);
    expect(found?.id).toBe(a.fundingSourceId);
  });

  it("findFundingSource refuses a malformed id without reaching the database", async () => {
    const a = await org({ name: "Malformed Id Org" });
    expect(await findFundingSource(a.orgId, "not-a-uuid")).toBeNull();
  });

  it("requireOwnedFundingSource returns the source when owned, a denial otherwise", async () => {
    const a = await org({ name: "Ownership Check Org" });
    const b = await org({ name: "Other Ownership Org" });

    const owned = await requireOwnedFundingSource({ orgId: a.orgId }, a.fundingSourceId);
    expect("denied" in owned).toBe(false);

    const denied = await requireOwnedFundingSource({ orgId: a.orgId }, b.fundingSourceId);
    expect("denied" in denied).toBe(true);
  });
});
