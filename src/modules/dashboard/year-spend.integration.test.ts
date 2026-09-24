/**
 * `loadYearSpend` — the twelve columns behind the dashboard's chart.
 *
 * It is a money total, so it answers to R10.2 like every other one: the figure on the chart
 * has to be the same figure the rest of the app would print for that month. The reason it sums
 * in TypeScript rather than in SQL is that whether tax and fees count is a per-expense decision
 * (R1.3), and a `SUM()` would restate that rule in a second place where it could drift — so the
 * case that matters most here is the one where two expenses in the same month disagree about
 * their own reimbursement rules.
 *
 * The rest is scoping and shape: another organisation's rows, another source's rows, another
 * year's rows and deleted rows all stay out, and all twelve months come back whether or not
 * they hold anything.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("loadYearSpend (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, fundingSources, lineItems, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { loadYearSpend } = await import("./queries");

  const YEAR = 2094;

  let orgId: string;
  let sourceA: string;
  let sourceB: string;
  let itemA: string;
  let itemB: string;
  let otherOrgId: string;
  let otherOrgSource: string;
  let otherOrgItem: string;

  /**
   * `lineItemId` is required and not nullable here, unlike on a draft: an expense always has
   * one (R9.3), and the composite FK pins it to the expense's own funding source, so each
   * source below needs a line item of its own.
   */
  async function addExpense(input: {
    orgId: string;
    sourceId: string;
    lineItemId: string;
    month: string;
    subtotalCents: number;
    taxCents?: number;
    feesCents?: number;
    taxReimbursable?: boolean;
    feesReimbursable?: boolean;
    deleted?: boolean;
  }) {
    await db.insert(expenses).values({
      orgId: input.orgId,
      fundingSourceId: input.sourceId,
      lineItemId: input.lineItemId,
      month: input.month,
      date: `${input.month}-05`,
      name: "Expense",
      paymentSource: "x",
      subtotalCents: input.subtotalCents,
      taxCents: input.taxCents ?? 0,
      feesCents: input.feesCents ?? 0,
      taxReimbursable: input.taxReimbursable ?? false,
      feesReimbursable: input.feesReimbursable ?? false,
      sortOrder: 0,
      referenceSeq: await claimReferenceSeq(input.orgId, input.sourceId, input.month),
      ...(input.deleted ? { deletedAt: new Date() } : {}),
    });
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Year Spend Org", activeMonth: `${YEAR}-01` });
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
        feesReimbursable: true,
      })
      .returning({ id: fundingSources.id });
    sourceB = b.id;

    const [ia] = await db
      .insert(lineItems)
      .values({
        orgId,
        fundingSourceId: sourceA,
        name: "Item A",
        scheduledValueCents: 1_000_000,
        sortOrder: 0,
      })
      .returning({ id: lineItems.id });
    itemA = ia.id;

    const [ib] = await db
      .insert(lineItems)
      .values({
        orgId,
        fundingSourceId: sourceB,
        name: "Item B",
        scheduledValueCents: 1_000_000,
        sortOrder: 0,
      })
      .returning({ id: lineItems.id });
    itemB = ib.id;

    const other = await createTestOrg({ name: "Other Year Spend Org" });
    otherOrgId = other.orgId;
    otherOrgSource = other.fundingSourceId;

    const [io] = await db
      .insert(lineItems)
      .values({
        orgId: otherOrgId,
        fundingSourceId: otherOrgSource,
        name: "Other org item",
        scheduledValueCents: 1_000_000,
        sortOrder: 0,
      })
      .returning({ id: lineItems.id });
    otherOrgItem = io.id;
  });

  // Every row here hangs off these organisations and goes with them; the files under their
  // storage prefix do not, so those are removed by hand.
  afterAll(async () => {
    const { rm } = await import("node:fs/promises");
    const path = await import("node:path");
    for (const id of [orgId, otherOrgId]) {
      if (!id) continue;
      await db.delete(organizations).where(eq(organizations.id, id));
      await rm(path.join(process.cwd(), ".storage", "org", id), { recursive: true, force: true });
    }
  });

  it("returns all twelve months in order, and a month with nothing in it reads zero", async () => {
    const rows = await loadYearSpend(orgId, sourceA, YEAR);

    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.month)).toEqual([
      `${YEAR}-01`, `${YEAR}-02`, `${YEAR}-03`, `${YEAR}-04`, `${YEAR}-05`, `${YEAR}-06`,
      `${YEAR}-07`, `${YEAR}-08`, `${YEAR}-09`, `${YEAR}-10`, `${YEAR}-11`, `${YEAR}-12`,
    ]);
    expect(rows.map((row) => row.label)).toEqual([
      "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]);
    // A year with no expenses at all is twelve empty columns, not an empty array.
    expect(rows.every((row) => row.spentCents === 0)).toBe(true);
  });

  it("honours each expense's own tax and fees rules rather than one rule for the month", async () => {
    // Two expenses, same month, same source, disagreeing about what is reimbursable. This is
    // the case a `SUM(subtotal + tax + fees)` in SQL would get wrong.
    await addExpense({
      orgId,
      sourceId: sourceA,
      lineItemId: itemA,
      month: `${YEAR}-03`,
      subtotalCents: 10_000,
      taxCents: 800,
      feesCents: 200,
      taxReimbursable: true,
      feesReimbursable: false,
    });
    await addExpense({
      orgId,
      sourceId: sourceA,
      lineItemId: itemA,
      month: `${YEAR}-03`,
      subtotalCents: 5_000,
      taxCents: 400,
      feesCents: 100,
      taxReimbursable: false,
      feesReimbursable: true,
    });

    const rows = await loadYearSpend(orgId, sourceA, YEAR);
    const march = rows.find((row) => row.month === `${YEAR}-03`);

    // (10_000 + 800) + (5_000 + 100) = 15_900. The tax of the second and the fees of the
    // first are excluded because those two expenses said so.
    expect(march?.spentCents).toBe(15_900);
  });

  it("excludes deleted expenses", async () => {
    await addExpense({
      orgId,
      sourceId: sourceA,
      lineItemId: itemA,
      month: `${YEAR}-05`,
      subtotalCents: 7_000,
    });
    await addExpense({
      orgId,
      sourceId: sourceA,
      lineItemId: itemA,
      month: `${YEAR}-05`,
      subtotalCents: 99_000,
      deleted: true,
    });

    const rows = await loadYearSpend(orgId, sourceA, YEAR);
    expect(rows.find((row) => row.month === `${YEAR}-05`)?.spentCents).toBe(7_000);
  });

  it("counts only the funding source asked for, and only that organisation", async () => {
    await addExpense({
      orgId,
      sourceId: sourceB,
      lineItemId: itemB,
      month: `${YEAR}-07`,
      subtotalCents: 33_000,
    });
    await addExpense({
      orgId: otherOrgId,
      sourceId: otherOrgSource,
      lineItemId: otherOrgItem,
      month: `${YEAR}-07`,
      subtotalCents: 44_000,
    });

    const forA = await loadYearSpend(orgId, sourceA, YEAR);
    expect(forA.find((row) => row.month === `${YEAR}-07`)?.spentCents).toBe(0);

    const forB = await loadYearSpend(orgId, sourceB, YEAR);
    expect(forB.find((row) => row.month === `${YEAR}-07`)?.spentCents).toBe(33_000);

    // The other organisation's row is invisible from here even though the source id is real.
    const crossOrg = await loadYearSpend(orgId, otherOrgSource, YEAR);
    expect(crossOrg.every((row) => row.spentCents === 0)).toBe(true);
  });

  it("stops at the year's edges — December before and January after stay out", async () => {
    // The range is a string comparison on a fixed-width `YYYY-MM` column, so the boundary
    // months on either side are what would break if that ever stopped being true.
    await addExpense({
      orgId,
      sourceId: sourceA,
      lineItemId: itemA,
      month: `${YEAR - 1}-12`,
      subtotalCents: 11_100,
    });
    await addExpense({
      orgId,
      sourceId: sourceA,
      lineItemId: itemA,
      month: `${YEAR + 1}-01`,
      subtotalCents: 22_200,
    });
    // And the two months that are inside, at the very edges.
    await addExpense({
      orgId,
      sourceId: sourceA,
      lineItemId: itemA,
      month: `${YEAR}-01`,
      subtotalCents: 1_111,
    });
    await addExpense({
      orgId,
      sourceId: sourceA,
      lineItemId: itemA,
      month: `${YEAR}-12`,
      subtotalCents: 2_222,
    });

    const rows = await loadYearSpend(orgId, sourceA, YEAR);
    expect(rows[0]).toMatchObject({ month: `${YEAR}-01`, spentCents: 1_111 });
    expect(rows[11]).toMatchObject({ month: `${YEAR}-12`, spentCents: 2_222 });

    // The neighbouring years are reachable on their own, which proves the rows really exist
    // and the year filter is what kept them out rather than the insert having failed.
    const previous = await loadYearSpend(orgId, sourceA, YEAR - 1);
    expect(previous.find((row) => row.month === `${YEAR - 1}-12`)?.spentCents).toBe(11_100);
    const next = await loadYearSpend(orgId, sourceA, YEAR + 1);
    expect(next.find((row) => row.month === `${YEAR + 1}-01`)?.spentCents).toBe(22_200);
  });

  it("sums a month holding many expenses rather than reporting only one of them", async () => {
    for (const cents of [1_00, 2_50, 3_33, 10_000]) {
      await addExpense({
        orgId,
        sourceId: sourceA,
        lineItemId: itemA,
        month: `${YEAR}-09`,
        subtotalCents: cents,
      });
    }

    const rows = await loadYearSpend(orgId, sourceA, YEAR);
    // 100 + 250 + 333 + 10_000
    expect(rows.find((row) => row.month === `${YEAR}-09`)?.spentCents).toBe(10_683);
  });
});
