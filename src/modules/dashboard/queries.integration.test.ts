/**
 * ★ Per-source isolation for the dashboard loader (Phase 5, D-93): a submitted snapshot for
 * one source must never surface as drift on another source's section, and one source's budget
 * total must never include another source's line items.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("loadSourceBudget isolation (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, fundingSources, lineItems, monthSnapshots, organizations } = await import(
    "@/src/db/schema"
  );
  const { createTestOrg } = await import("@/src/db/test-org");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { loadSourceBudget } = await import("./queries");

  const MONTH = "2097-03";
  let orgId: string;
  let sourceA: string;
  let sourceB: string;
  let itemA: string;
  let itemB: string;

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Dashboard Isolation Org", activeMonth: MONTH });
    orgId = org.orgId;
    sourceA = org.fundingSourceId;

    const [b] = await db
      .insert(fundingSources)
      .values({
        orgId,
        name: "Source B",
        type: "donation",
        sortOrder: 1,
        taxReimbursable: true,
        feesReimbursable: false,
      })
      .returning({ id: fundingSources.id });
    sourceB = b.id;

    const [ia] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceA, name: "A's item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    itemA = ia.id;

    const [ib] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceB, name: "B's item", scheduledValueCents: 200_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    itemB = ib.id;

    await db.insert(expenses).values({
      orgId,
      fundingSourceId: sourceA,
      lineItemId: itemA,
      month: MONTH,
      date: `${MONTH}-05`,
      name: "A's expense",
      paymentSource: "x",
      subtotalCents: 1_000,
      taxReimbursable: false,
      feesReimbursable: true,
      sortOrder: 0,
      referenceSeq: await claimReferenceSeq(orgId, sourceA, MONTH),
    });

    await db.insert(expenses).values({
      orgId,
      fundingSourceId: sourceB,
      lineItemId: itemB,
      month: MONTH,
      date: `${MONTH}-06`,
      name: "B's expense",
      paymentSource: "x",
      subtotalCents: 2_000,
      taxReimbursable: false,
      feesReimbursable: true,
      sortOrder: 0,
      referenceSeq: await claimReferenceSeq(orgId, sourceB, MONTH),
    });

    // A submitted snapshot for source A ONLY, with figures deliberately different from the
    // live ones so drift is non-empty for A.
    await db.insert(monthSnapshots).values({
      orgId,
      fundingSourceId: sourceA,
      month: MONTH,
      lineItemId: itemA,
      lineItemName: "A's item",
      scheduledValueCents: 100_000,
      previouslyBilledCents: 0,
      spentThisMonthCents: 500, // live is 1,000 — deliberately different
      totalBilledCents: 500,
      remainingCents: 99_500,
    });
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("source A: only A's line item, A's own budget total, and non-empty drift naming A's item", async () => {
    const budget = await loadSourceBudget(orgId, sourceA, MONTH);
    expect(budget.lineItems.map((i) => i.id)).toEqual([itemA]);
    expect(budget.positions.map((p) => p.lineItemId)).toEqual([itemA]);
    // Never A+B — this is the "no combined total" proof at the data level.
    expect(budget.grant.approvedCents).toBe(100_000);
    expect(budget.drift.length).toBeGreaterThan(0);
    expect(budget.drift.map((d) => d.name)).toContain("A's item");
  });

  it("source B: only B's line item and no drift — A's submitted snapshot must not leak into B", async () => {
    const budget = await loadSourceBudget(orgId, sourceB, MONTH);
    expect(budget.lineItems.map((i) => i.id)).toEqual([itemB]);
    expect(budget.positions.map((p) => p.lineItemId)).toEqual([itemB]);
    expect(budget.grant.approvedCents).toBe(200_000);
    expect(budget.drift).toEqual([]);
  });
});
