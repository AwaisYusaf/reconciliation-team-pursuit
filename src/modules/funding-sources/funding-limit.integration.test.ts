/**
 * The funding limit (R9.6, D-134) on the Settings side, against a real database, through
 * `updateFundingSourceAction`: a contract value that would put the contract total below the line
 * items is refused, unless the source is already over and the change doesn't make it worse.
 * Clearing the contract value removes the limit. Also the end-before-start date check (#15, #21).
 *
 * The race: a line item raise held open on the source row makes a contract value cut wait, and the
 * cut is then judged on the raised line items, not the ones it read before waiting.
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => {
  const session = vi.fn();
  return { actionSession: session, actionSessionAnyPlan: session };
});

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

const K = 100_000; // $1,000.00 in cents

describe.skipIf(!hasDatabase)("funding limit on the contract value (integration, R9.6)", async () => {
  const { db } = await import("@/src/db");
  const { fundingSources, lineItemPerformances, lineItems, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { holdOpen } = await import("@/src/db/hold-open.test-helper");
  const { UI } = await import("@/src/domain/strings");
  const { actionSession } = await import("@/src/lib/action-session");
  const { updateFundingSourceAction } = await import("./actions");

  const session = vi.mocked(actionSession);
  const createdOrgIds: string[] = [];

  afterAll(async () => {
    for (const id of createdOrgIds) await db.delete(organizations).where(eq(organizations.id, id));
  });

  const INPUT = {
    name: "Kresge Grant",
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

  /** A fresh org whose first source has this contract value and these line item base values. */
  async function source(contractValueCents: number, bases: number[]) {
    const { orgId, fundingSourceId } = await createTestOrg({
      name: `Contract value limit ${Date.now()}`,
      fundingSourceName: INPUT.name,
    });
    createdOrgIds.push(orgId);
    await db.update(fundingSources).set({ contractValueCents }).where(eq(fundingSources.id, fundingSourceId));
    const ids: string[] = [];
    for (const [index, cents] of bases.entries()) {
      const [row] = await db
        .insert(lineItems)
        .values({ orgId, fundingSourceId, name: `Item ${index + 1}`, scheduledValueCents: cents, sortOrder: index })
        .returning({ id: lineItems.id });
      ids.push(row.id);
    }
    session.mockResolvedValue({
      orgId,
      userId: "u",
      email: "e@example.com",
      role: "manager", // managers manage funding sources too (Appendix A §1)
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2026-02",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    });
    return { orgId, fundingSourceId, ids };
  }

  const save = (id: string, fields: Partial<typeof INPUT>) => updateFundingSourceAction({ ...INPUT, ...fields, id });

  async function stored(id: string) {
    const [row] = await db.select().from(fundingSources).where(eq(fundingSources.id, id));
    return row;
  }

  it("E14: a contract value below the line items is refused with the exact message; nothing changes", async () => {
    const { fundingSourceId } = await source(150 * K, [100 * K, 50 * K]);
    expect(await save(fundingSourceId, { contractValue: "149,999.99", contractNumber: "6007211" })).toEqual({
      ok: false,
      error: UI.contractValueBelowLineItems("$150,000.00", "$149,999.99"),
    });
    const row = await stored(fundingSourceId);
    expect(row.contractValueCents).toBe(150 * K);
    expect(row.contractNumber).toBe(""); // the whole save is refused, not only the value
  });

  it("equal to the line items is within the limit", async () => {
    const { fundingSourceId } = await source(200 * K, [150 * K]);
    expect((await save(fundingSourceId, { contractValue: "150,000.00" })).ok).toBe(true);
    expect((await stored(fundingSourceId)).contractValueCents).toBe(150 * K);
  });

  it("E15: a source already over can raise its contract value even though it stays over", async () => {
    const { fundingSourceId } = await source(150 * K, [250 * K]);
    expect((await save(fundingSourceId, { contractValue: "200,000.00" })).ok).toBe(true);
    expect((await stored(fundingSourceId)).contractValueCents).toBe(200 * K);
  });

  it("E15b: a source already over cannot cut its contract value further", async () => {
    const { fundingSourceId } = await source(150 * K, [250 * K]);
    expect(await save(fundingSourceId, { contractValue: "140,000.00" })).toEqual({
      ok: false,
      error: UI.contractValueBelowLineItems("$250,000.00", "$140,000.00"),
    });
  });

  it("E16: clearing the contract value (blank or 0) removes the limit", async () => {
    const { fundingSourceId } = await source(150 * K, [150 * K]);
    expect((await save(fundingSourceId, { contractValue: "" })).ok).toBe(true);
    expect((await stored(fundingSourceId)).contractValueCents).toBe(0);
    await db.update(fundingSources).set({ contractValueCents: 150 * K }).where(eq(fundingSources.id, fundingSourceId));
    expect((await save(fundingSourceId, { contractValue: "0" })).ok).toBe(true);
    expect((await stored(fundingSourceId)).contractValueCents).toBe(0);
  });

  it("E17: a source already over can still edit its other details", async () => {
    const { fundingSourceId } = await source(150 * K, [250 * K]);
    expect((await save(fundingSourceId, { contractValue: "150,000.00", basePoNumber: "3086984" })).ok).toBe(true);
    expect((await stored(fundingSourceId)).basePoNumber).toBe("3086984");
  });

  it("E18: a first contract value on a source whose line items are larger is refused", async () => {
    const { fundingSourceId } = await source(0, [200 * K]);
    expect(await save(fundingSourceId, { contractValue: "150,000.00" })).toEqual({
      ok: false,
      error: UI.contractValueBelowLineItems("$200,000.00", "$150,000.00"),
    });
    expect((await stored(fundingSourceId)).contractValueCents).toBe(0);
  });

  it("E19: new performances count on both sides (value + performances vs base + performances)", async () => {
    const { orgId, fundingSourceId, ids } = await source(150 * K, [150 * K]);
    await db.insert(lineItemPerformances).values({
      orgId,
      lineItemId: ids[0],
      name: "Summer show",
      date: "2026-06-01",
      amountCents: 10 * K,
      sortOrder: 0,
      countsTowardContractTotal: true,
    });
    // Line items 160k; a 149,999.99 value gives a 159,999.99 total.
    expect(await save(fundingSourceId, { contractValue: "149,999.99" })).toEqual({
      ok: false,
      error: UI.contractValueBelowLineItems("$160,000.00", "$159,999.99"),
    });
    expect((await save(fundingSourceId, { contractValue: "150,000.00" })).ok).toBe(true);
  });

  it("E20: an end date before the start date is refused; the same day is fine", async () => {
    const { fundingSourceId } = await source(0, []);
    expect(await save(fundingSourceId, { contractStart: "2026-10-01", contractEnd: "2026-09-30" })).toEqual({
      ok: false,
      error: "The contract end date is before the start date.",
    });
    expect((await stored(fundingSourceId)).contractEnd).toBeNull();
    expect((await save(fundingSourceId, { contractStart: "2026-10-01", contractEnd: "2026-10-01" })).ok).toBe(true);
  });

  it("E22: a cut waits for a line item raise being saved, then is refused on the raised line items", async () => {
    const { fundingSourceId, ids } = await source(150 * K, [100 * K]);
    const { result, blocked } = await holdOpen(
      async (tx) => {
        // What saveLineItemAction does: the source row locked, then the line item raised.
        await tx
          .select({ id: fundingSources.id })
          .from(fundingSources)
          .where(eq(fundingSources.id, fundingSourceId))
          .for("no key update");
        await tx.update(lineItems).set({ scheduledValueCents: 140 * K }).where(eq(lineItems.id, ids[0]));
      },
      // Fine against the 100k it could read before waiting; not against the 140k committed.
      () => save(fundingSourceId, { contractValue: "120,000.00" }),
    );
    expect(blocked).toBe(true);
    expect(result).toEqual({ ok: false, error: UI.contractValueBelowLineItems("$140,000.00", "$120,000.00") });
    expect((await stored(fundingSourceId)).contractValueCents).toBe(150 * K);
  });
});
