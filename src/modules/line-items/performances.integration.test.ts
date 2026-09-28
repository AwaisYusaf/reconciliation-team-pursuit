/**
 * `addLineItemPerformanceAction` / `deleteLineItemPerformanceAction` against a real database
 * (m08).
 *
 * The Performance Grant used to be one hand-maintained figure in Settings (R7.2). It is now
 * built from performances added directly to a line item, each rolling into that line item's
 * effective Scheduled Value via `loadLineItemBudgets` â€” this proves that roundtrip actually
 * happens, not just that the row gets inserted. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("line item performances (integration)", async () => {
  const { db } = await import("@/src/db");
  const { lineItemPerformances, lineItems, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { loadLineItemBudgets } = await import("@/src/db/queries");
  const { actionSession } = await import("@/src/lib/action-session");
  const {
    addLineItemPerformanceAction,
    saveLineItemPerformanceAction,
    deleteLineItemPerformanceAction,
    deleteLineItemAction,
  } = await import("./actions");

  const session = vi.mocked(actionSession);

  let orgId: string;
  let fundingSourceId: string;
  let otherOrgId: string;
  let lineItemId: string;

  function asOrg(id: string) {
    session.mockResolvedValue({
      orgId: id,
      userId: "u",
      email: "e@example.com",
      role: "admin",
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2026-02",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    });
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "m08 Performances Org", docName: "Perf", activeMonth: "2026-02" });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;
    const other = await createTestOrg({ name: "m08 Performances Other Org", docName: "Other", activeMonth: "2026-02" });
    otherOrgId = other.orgId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Performance Grant 1", scheduledValueCents: 0, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
    if (otherOrgId) await db.delete(organizations).where(eq(organizations.id, otherOrgId));
  });

  it("rejects a blank, zero or negative amount without touching the database", async () => {
    asOrg(orgId);
    for (const bad of ["", "0", "0.00", "-5.00", "not a number"]) {
      const result = await addLineItemPerformanceAction({
        lineItemId,
        name: "Test performance",
        amount: bad,
        date: "2026-02-01",
      });
      expect(result.ok).toBe(false);
    }
    const [{ scheduledValueCents }] = await loadLineItemBudgets(orgId, fundingSourceId);
    expect(scheduledValueCents).toBe(0);
  });

  it("rejects a blank or whitespace-only name without touching the database", async () => {
    asOrg(orgId);
    for (const bad of ["", "   "]) {
      const result = await addLineItemPerformanceAction({
        lineItemId,
        name: bad,
        amount: "500.00",
        date: "2026-02-01",
      });
      expect(result.ok).toBe(false);
    }
    const [{ scheduledValueCents }] = await loadLineItemBudgets(orgId, fundingSourceId);
    expect(scheduledValueCents).toBe(0);
  });

  it("rejects a missing or malformed date without touching the database", async () => {
    asOrg(orgId);
    for (const bad of ["", "not-a-date", "2026-13-40", "02/01/2026"]) {
      const result = await addLineItemPerformanceAction({
        lineItemId,
        name: "Test performance",
        amount: "500.00",
        date: bad,
      });
      expect(result.ok).toBe(false);
    }
    const [{ scheduledValueCents }] = await loadLineItemBudgets(orgId, fundingSourceId);
    expect(scheduledValueCents).toBe(0);
  });

  it("refuses to add a performance to another organisation's line item", async () => {
    asOrg(otherOrgId);
    const result = await addLineItemPerformanceAction({
      lineItemId,
      name: "Test performance",
      amount: "100.00",
      date: "2026-02-01",
    });
    expect(result.ok).toBe(false);
  });

  it("adding a performance rolls straight into the line item's effective Scheduled Value, name and date round-trip", async () => {
    asOrg(orgId);
    const first = await addLineItemPerformanceAction({
      lineItemId,
      name: "Q1 outcomes bonus",
      amount: "175000.00",
      date: "2026-02-14",
    });
    expect(first.ok).toBe(true);

    const [budget] = await loadLineItemBudgets(orgId, fundingSourceId);
    expect(budget.scheduledValueCents).toBe(17500000);
    // The performance-only slice (D-81) â€” what a renderer needs to show the split â€” read back
    // from the database alongside the combined total, not just derived in a test fixture.
    expect(budget.performanceCents).toBe(17500000);

    const { loadLineItemRows } = await import("./queries");
    const [row] = (await loadLineItemRows(orgId, fundingSourceId)).filter((r) => r.id === lineItemId);
    const added = row.performances.find((p) => p.amountCents === 17500000);
    expect(added?.name).toBe("Q1 outcomes bonus");
    expect(added?.date).toBe("2026-02-14");

    const second = await addLineItemPerformanceAction({
      lineItemId,
      name: "Q2 outcomes bonus",
      amount: "25000.00",
      date: "2026-05-01",
    });
    expect(second.ok).toBe(true);

    const [afterSecond] = await loadLineItemBudgets(orgId, fundingSourceId);
    expect(afterSecond.scheduledValueCents).toBe(20000000);
    expect(afterSecond.performanceCents).toBe(20000000);
  });

  it("a migrated performance doesn't count toward the contract total, but a new one does (D-82)", async () => {
    // The client's real migrated org: `contract_value_cents` already meant the whole contract,
    // performance grant included, before that money had a line item of its own. Simulated here
    // by inserting a performance directly, the way `drizzle/0015_narrow_diamondback.sql` did,
    // bypassing the action entirely â€” `counts_toward_contract_total` must default false, not
    // true, or `loadLineItemBudgets` would report it as money the org's contract value hasn't
    // caught up to yet, and `contractTotalCents` would double it (confirmed against real client
    // data: $940,000 read $1,115,000.00 before this column existed).
    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "D-82 migrated-style line item", scheduledValueCents: 0, sortOrder: 1 })
      .returning({ id: lineItems.id });

    await db.insert(lineItemPerformances).values({
      orgId,
      lineItemId: item.id,
      amountCents: 17500000,
      sortOrder: 0,
      // No `countsTowardContractTotal` â€” proving the column's default, not overriding it.
    });

    const [migratedBudget] = (await loadLineItemBudgets(orgId, fundingSourceId)).filter((row) => row.id === item.id);
    expect(migratedBudget.performanceCents).toBe(17500000);
    expect(migratedBudget.newPerformanceCents).toBe(0);

    // The row inserted above has no name/date (it predates those columns, D-92) â€” the
    // UI-facing query must still load and render it, honestly, rather than crash or guess.
    const { loadLineItemRows } = await import("./queries");
    const [legacyRow] = (await loadLineItemRows(orgId, fundingSourceId)).filter((r) => r.id === item.id);
    const legacyPerformance = legacyRow.performances.find((p) => p.amountCents === 17500000);
    expect(legacyPerformance?.name).toBeNull();
    expect(legacyPerformance?.date).toBeNull();

    asOrg(orgId);
    const added = await addLineItemPerformanceAction({
      lineItemId: item.id,
      name: "New performance",
      amount: "1000.00",
      date: "2026-03-01",
    });
    expect(added.ok).toBe(true);

    const [afterAdd] = (await loadLineItemBudgets(orgId, fundingSourceId)).filter((row) => row.id === item.id);
    // The migrated $175,000 still doesn't count; the new $1,000 does.
    expect(afterAdd.performanceCents).toBe(17500000 + 100000);
    expect(afterAdd.newPerformanceCents).toBe(100000);
  });

  it("saveLineItemPerformanceAction (D-92): edits name, amount and date in place, changing the total by exactly the delta", async () => {
    asOrg(orgId);
    const created = await addLineItemPerformanceAction({
      lineItemId,
      name: "Original name",
      amount: "300.00",
      date: "2026-01-01",
    });
    expect(created.ok).toBe(true);

    const { loadLineItemRows } = await import("./queries");
    const before = (await loadLineItemRows(orgId, fundingSourceId)).find((r) => r.id === lineItemId)!;
    const target = before.performances.find((p) => p.name === "Original name")!;

    const edited = await saveLineItemPerformanceAction({
      id: target.id,
      name: "Renamed performance",
      amount: "450.00",
      date: "2026-03-15",
    });
    expect(edited.ok).toBe(true);

    const after = (await loadLineItemRows(orgId, fundingSourceId)).find((r) => r.id === lineItemId)!;
    const updated = after.performances.find((p) => p.id === target.id)!;
    expect(updated.name).toBe("Renamed performance");
    expect(updated.date).toBe("2026-03-15");
    expect(updated.amountCents).toBe(45000);

    // The line item's total moved by exactly the amount delta (450 - 300 = 150), not by the
    // new amount alone â€” proving this is an update in place, not a second insert.
    expect(after.totalScheduledValueCents - before.totalScheduledValueCents).toBe(15000);

    // Clean up so it doesn't leak into the delete/cascade tests below.
    await deleteLineItemPerformanceAction(target.id);
  });

  it("saveLineItemPerformanceAction rejects a blank name, invalid date or non-positive amount without changing the row", async () => {
    asOrg(orgId);
    const created = await addLineItemPerformanceAction({
      lineItemId,
      name: "Untouched",
      amount: "200.00",
      date: "2026-01-01",
    });
    expect(created.ok).toBe(true);
    const { loadLineItemRows } = await import("./queries");
    const target = (await loadLineItemRows(orgId, fundingSourceId))
      .find((r) => r.id === lineItemId)!
      .performances.find((p) => p.name === "Untouched")!;

    const rejections = await Promise.all([
      saveLineItemPerformanceAction({ id: target.id, name: "", amount: "200.00", date: "2026-01-01" }),
      saveLineItemPerformanceAction({ id: target.id, name: "Untouched", amount: "0", date: "2026-01-01" }),
      saveLineItemPerformanceAction({ id: target.id, name: "Untouched", amount: "200.00", date: "not-a-date" }),
    ]);
    for (const result of rejections) expect(result.ok).toBe(false);

    const unchanged = (await loadLineItemRows(orgId, fundingSourceId))
      .find((r) => r.id === lineItemId)!
      .performances.find((p) => p.id === target.id)!;
    expect(unchanged.name).toBe("Untouched");
    expect(unchanged.amountCents).toBe(20000);
    expect(unchanged.date).toBe("2026-01-01");

    await deleteLineItemPerformanceAction(target.id);
  });

  it("refuses to edit another organisation's performance", async () => {
    asOrg(orgId);
    const created = await addLineItemPerformanceAction({
      lineItemId,
      name: "Org A's own",
      amount: "600.00",
      date: "2026-01-01",
    });
    expect(created.ok).toBe(true);
    const { loadLineItemRows } = await import("./queries");
    const target = (await loadLineItemRows(orgId, fundingSourceId))
      .find((r) => r.id === lineItemId)!
      .performances.find((p) => p.name === "Org A's own")!;

    asOrg(otherOrgId);
    const result = await saveLineItemPerformanceAction({
      id: target.id,
      name: "Hijacked",
      amount: "1.00",
      date: "2026-01-01",
    });
    expect(result.ok).toBe(false);

    asOrg(orgId);
    const unchanged = (await loadLineItemRows(orgId, fundingSourceId))
      .find((r) => r.id === lineItemId)!
      .performances.find((p) => p.id === target.id)!;
    expect(unchanged.name).toBe("Org A's own");
    expect(unchanged.amountCents).toBe(60000);

    await deleteLineItemPerformanceAction(target.id);
  });

  it("a migrated performance's amount is locked â€” name/date still editable, contract total can't drift (D-92)", async () => {
    // Inserted directly, like the migration did: `countsTowardContractTotal` defaults false.
    // Editing its amount would move the line item's Scheduled Value but not the contract
    // total (a boolean can't say "only the delta is new money"), so the action refuses it.
    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "D-92 locked-amount line item", scheduledValueCents: 0, sortOrder: 2 })
      .returning({ id: lineItems.id });
    const [legacy] = await db
      .insert(lineItemPerformances)
      .values({ orgId, lineItemId: item.id, amountCents: 17500000, sortOrder: 0 })
      .returning({ id: lineItemPerformances.id });

    asOrg(orgId);
    const added = await addLineItemPerformanceAction({
      lineItemId: item.id,
      name: "New money",
      amount: "1000.00",
      date: "2026-03-01",
    });
    expect(added.ok).toBe(true);

    const { loadLineItemRows } = await import("./queries");
    const performances = (await loadLineItemRows(orgId, fundingSourceId)).find((r) => r.id === item.id)!.performances;
    expect(performances.find((p) => p.id === legacy.id)!.amountLocked).toBe(true);
    expect(performances.find((p) => p.name === "New money")!.amountLocked).toBe(false);

    const refused = await saveLineItemPerformanceAction({
      id: legacy.id,
      name: "Performance Grant",
      amount: "200000.00",
      date: "2026-01-01",
    });
    expect(refused).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already part of the contract value/),
    });

    const [afterRefusal] = (await loadLineItemBudgets(orgId, fundingSourceId)).filter((row) => row.id === item.id);
    expect(afterRefusal.performanceCents).toBe(17500000 + 100000);
    expect(afterRefusal.newPerformanceCents).toBe(100000);
    const stillLegacy = (await loadLineItemRows(orgId, fundingSourceId))
      .find((r) => r.id === item.id)!
      .performances.find((p) => p.id === legacy.id)!;
    // The refusal is all-or-nothing: the name/date sent alongside the amount weren't written either.
    expect(stillLegacy.name).toBeNull();
    expect(stillLegacy.date).toBeNull();

    // Same amount, real name/date: allowed, and it backfills the legacy row's blanks.
    const renamed = await saveLineItemPerformanceAction({
      id: legacy.id,
      name: "Performance Grant",
      amount: "175000.00",
      date: "2026-01-01",
    });
    expect(renamed.ok).toBe(true);
    const backfilled = (await loadLineItemRows(orgId, fundingSourceId))
      .find((r) => r.id === item.id)!
      .performances.find((p) => p.id === legacy.id)!;
    expect(backfilled.name).toBe("Performance Grant");
    expect(backfilled.date).toBe("2026-01-01");
    expect(backfilled.amountLocked).toBe(true);

    // A new performance's amount stays editable.
    const newOne = performances.find((p) => p.name === "New money")!;
    const editedNew = await saveLineItemPerformanceAction({
      id: newOne.id,
      name: "New money",
      amount: "1500.00",
      date: "2026-03-01",
    });
    expect(editedNew.ok).toBe(true);
    const [afterNewEdit] = (await loadLineItemBudgets(orgId, fundingSourceId)).filter((row) => row.id === item.id);
    expect(afterNewEdit.newPerformanceCents).toBe(150000);

    // A missing id still says so, rather than the locked-amount message.
    const missing = await saveLineItemPerformanceAction({
      id: "00000000-0000-4000-8000-000000000000",
      name: "Ghost",
      amount: "1.00",
      date: "2026-01-01",
    });
    expect(missing).toMatchObject({ ok: false, error: "That performance no longer exists." });
  });

  it("deleting a performance removes exactly its amount from the total", async () => {
    asOrg(orgId);
    const rows = await db
      .select({ id: lineItemPerformances.id, amountCents: lineItemPerformances.amountCents })
      .from(lineItemPerformances)
      .where(eq(lineItemPerformances.lineItemId, lineItemId));
    const toDelete = rows.find((row) => row.amountCents === 2500000)!;

    const result = await deleteLineItemPerformanceAction(toDelete.id);
    expect(result.ok).toBe(true);

    const [budget] = await loadLineItemBudgets(orgId, fundingSourceId);
    expect(budget.scheduledValueCents).toBe(17500000);
  });

  it("refuses to delete another organisation's performance", async () => {
    const rows = await db
      .select({ id: lineItemPerformances.id })
      .from(lineItemPerformances)
      .where(eq(lineItemPerformances.lineItemId, lineItemId));

    asOrg(otherOrgId);
    const result = await deleteLineItemPerformanceAction(rows[0].id);
    expect(result.ok).toBe(false);

    asOrg(orgId);
    const [budget] = await loadLineItemBudgets(orgId, fundingSourceId);
    expect(budget.scheduledValueCents).toBe(17500000); // untouched
  });

  it("names the performance total in the delete-confirmation message, then cascades on confirm", async () => {
    asOrg(orgId);
    const asked = await deleteLineItemAction(lineItemId, false);
    expect(asked.ok).toBe(true);
    if (!asked.ok) throw new Error("unreachable");
    expect(asked.data.requiresConfirmation?.performanceTotalCents).toBe(17500000);

    const confirmed = await deleteLineItemAction(lineItemId, asked.data.requiresConfirmation!);
    expect(confirmed).toEqual({ ok: true, data: {} });

    // Cascade-deleted with the line item (FK onDelete: "cascade") â€” nothing orphaned.
    const remaining = await db
      .select()
      .from(lineItemPerformances)
      .where(eq(lineItemPerformances.lineItemId, lineItemId));
    expect(remaining).toHaveLength(0);
  });
});
