/**
 * The funding limit (R9.6, D-134) on the line item side, against a real database, through the
 * real actions: a funding source's line items (base values plus performances) may not add up to
 * more than its contract total (R7.3: the contract value plus every new performance).
 *
 * - Adding or raising a line item past the total is refused and saves nothing.
 * - Only a change that leaves the line items *further* over is refused, so a source already over
 *   (from before the rule) can still lower, rename, change opening billed or add $0.
 * - Performances are never refused: a counted one raises both sides equally (proven at the limit
 *   and over it).
 * - No contract value means no limit.
 * - Races: a contract value cut held open makes a raise wait and then refuse; an archive held
 *   open makes an add wait and then refuse (R14.3); an add and an archive holding the org lock
 *   queue instead of deadlocking.
 *
 * Regression guards that also passed before R9.6 (not proofs of it): the foreign source and the
 * deleted line item rows. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

const K = 100_000; // $1,000.00 in cents

describe.skipIf(!hasDatabase)("funding limit on line items (integration, R9.6)", async () => {
  const { db } = await import("@/src/db");
  const { fundingSources, lineItemPerformances, lineItems, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { holdOpen } = await import("@/src/db/hold-open.test-helper");
  const { todayIso } = await import("@/src/domain/dates");
  const { UI } = await import("@/src/domain/strings");
  const { actionSession } = await import("@/src/lib/action-session");
  const {
    addLineItemPerformanceAction,
    deleteLineItemAction,
    deleteLineItemPerformanceAction,
    saveLineItemAction,
    saveLineItemPerformanceAction,
  } = await import("./actions");

  const session = vi.mocked(actionSession);
  const createdOrgIds: string[] = [];
  const ARCHIVED = "That funding source is archived. Unarchive it in Settings to add line items.";

  afterAll(async () => {
    for (const id of createdOrgIds) await db.delete(organizations).where(eq(organizations.id, id));
  });

  function asSession(orgId: string) {
    session.mockResolvedValue({
      orgId,
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

  /** A fresh org whose first source has this contract value and these line item base values. */
  async function source(contractValueCents: number, bases: number[]) {
    const { orgId, fundingSourceId } = await createTestOrg({ name: `Funding limit ${Date.now()}` });
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
    asSession(orgId);
    return { orgId, fundingSourceId, ids };
  }

  const dollars = (cents: number) => (cents / 100).toFixed(2);

  const add = (fundingSourceId: string, name: string, cents: number) =>
    saveLineItemAction({ fundingSourceId, name, scheduledValue: dollars(cents), openingBilled: "" });

  const edit = (fundingSourceId: string, id: string, name: string, cents: number, openingCents = 0) =>
    saveLineItemAction({ id, fundingSourceId, name, scheduledValue: dollars(cents), openingBilled: dollars(openingCents) });

  const addPerformance = (lineItemId: string, cents: number) =>
    addLineItemPerformanceAction({ lineItemId, name: "Summer show", amount: dollars(cents), date: todayIso() });

  async function basesOf(fundingSourceId: string) {
    const rows = await db
      .select({ name: lineItems.name, cents: lineItems.scheduledValueCents, opening: lineItems.openingBilledCents })
      .from(lineItems)
      .where(eq(lineItems.fundingSourceId, fundingSourceId))
      .orderBy(lineItems.sortOrder);
    return rows;
  }

  async function performanceAmounts(lineItemId: string) {
    const rows = await db
      .select({ cents: lineItemPerformances.amountCents })
      .from(lineItemPerformances)
      .where(eq(lineItemPerformances.lineItemId, lineItemId));
    return rows.map((row) => row.cents);
  }

  async function performanceIds(lineItemId: string) {
    const rows = await db
      .select({ id: lineItemPerformances.id })
      .from(lineItemPerformances)
      .where(eq(lineItemPerformances.lineItemId, lineItemId));
    return rows.map((row) => row.id);
  }

  describe("adding a line item", () => {
    it("E1: within the total is saved", async () => {
      const { fundingSourceId } = await source(150 * K, [100 * K]);
      expect(await add(fundingSourceId, "New", 40 * K)).toEqual({ ok: true, data: undefined });
      expect((await basesOf(fundingSourceId)).map((r) => r.cents)).toEqual([100 * K, 40 * K]);
    });

    it("E2: exactly the total is within it", async () => {
      const { fundingSourceId } = await source(150 * K, [100 * K]);
      expect((await add(fundingSourceId, "New", 50 * K)).ok).toBe(true);
      expect((await basesOf(fundingSourceId)).map((r) => r.cents)).toEqual([100 * K, 50 * K]);
    });

    it("E3: one cent past the total is refused with the exact message, and nothing is inserted", async () => {
      const { fundingSourceId } = await source(150 * K, [150 * K]);
      expect(await add(fundingSourceId, "New", 1)).toEqual({
        ok: false,
        error: UI.fundingLimitExceeded("$150,000.01", "$150,000.00"),
      });
      expect(await basesOf(fundingSourceId)).toHaveLength(1);
    });

    it("E10: no contract value means no limit", async () => {
      const { fundingSourceId } = await source(0, [200 * K]);
      expect((await add(fundingSourceId, "New", 1_000_000 * K)).ok).toBe(true);
      expect((await basesOf(fundingSourceId)).map((r) => r.cents)).toEqual([200 * K, 1_000_000 * K]);
    });
  });

  describe("editing a base value", () => {
    it("E4: a raise past the total is refused and the row is unchanged", async () => {
      const { fundingSourceId, ids } = await source(150 * K, [100 * K, 50 * K]);
      expect(await edit(fundingSourceId, ids[0], "Item 1", 100 * K + 1)).toEqual({
        ok: false,
        error: UI.fundingLimitExceeded("$150,000.01", "$150,000.00"),
      });
      expect((await basesOf(fundingSourceId))[0].cents).toBe(100 * K);
    });

    it("E5: a lowering is saved (the edit replaces its own old value, not adds to it)", async () => {
      const { fundingSourceId, ids } = await source(150 * K, [100 * K, 50 * K]);
      expect((await edit(fundingSourceId, ids[0], "Item 1", 90 * K)).ok).toBe(true);
      // Re-saving the same value at the limit is also allowed: counted once, not twice.
      expect((await edit(fundingSourceId, ids[1], "Item 2", 50 * K)).ok).toBe(true);
      expect((await basesOf(fundingSourceId)).map((r) => r.cents)).toEqual([90 * K, 50 * K]);
    });
  });

  describe("a source already over its total (from before R9.6)", () => {
    it("E6: can lower a line item even though it stays over", async () => {
      const { fundingSourceId, ids } = await source(150 * K, [200 * K, 50 * K]);
      expect((await edit(fundingSourceId, ids[0], "Item 1", 190 * K)).ok).toBe(true);
      expect((await basesOf(fundingSourceId))[0].cents).toBe(190 * K);
    });

    it("E7: cannot raise one by even a cent", async () => {
      const { fundingSourceId, ids } = await source(150 * K, [200 * K, 50 * K]);
      expect(await edit(fundingSourceId, ids[1], "Item 2", 50 * K + 1)).toEqual({
        ok: false,
        error: UI.fundingLimitExceeded("$250,000.01", "$150,000.00"),
      });
    });

    it("E8: can rename a line item and change its opening previously billed", async () => {
      const { fundingSourceId, ids } = await source(150 * K, [200 * K, 50 * K]);
      expect((await edit(fundingSourceId, ids[0], "Renamed", 200 * K, 5 * K)).ok).toBe(true);
      expect((await basesOf(fundingSourceId))[0]).toEqual({ name: "Renamed", cents: 200 * K, opening: 5 * K });
    });

    it("E9: can add a $0 line item (the over amount doesn't move)", async () => {
      const { fundingSourceId } = await source(150 * K, [250 * K]);
      expect((await add(fundingSourceId, "Placeholder", 0)).ok).toBe(true);
      expect((await basesOf(fundingSourceId)).map((r) => r.name)).toEqual(["Item 1", "Placeholder"]);
    });

    it("AC4: can delete a line item", async () => {
      const { fundingSourceId, ids } = await source(150 * K, [150 * K, 100 * K]);
      const asked = await deleteLineItemAction(ids[1], false);
      if (!asked.ok) throw new Error(asked.error);
      expect(await deleteLineItemAction(ids[1], asked.data.requiresConfirmation!)).toEqual({ ok: true, data: {} });
      expect((await basesOf(fundingSourceId)).map((r) => r.name)).toEqual(["Item 1"]);
    });
  });

  describe("performances are never refused (R9.6)", () => {
    it("E11: at the limit, a performance is added; the total moves with it, so the source is still exactly at it", async () => {
      const { fundingSourceId, ids } = await source(150 * K, [100 * K, 50 * K]);
      expect(await addPerformance(ids[0], 10 * K)).toEqual({ ok: true, data: undefined });
      expect(await performanceAmounts(ids[0])).toEqual([10 * K]);
      // Contract total is now 160k and the line items 160k: a 1 cent base raise goes over...
      expect(await edit(fundingSourceId, ids[1], "Item 2", 50 * K + 1)).toEqual({
        ok: false,
        error: UI.fundingLimitExceeded("$160,000.01", "$160,000.00"),
      });
      // ...and a lowering is fine.
      expect((await edit(fundingSourceId, ids[1], "Item 2", 40 * K)).ok).toBe(true);
      expect((await basesOf(fundingSourceId))[1].cents).toBe(40 * K);
    });

    it("E12: a source already over can still add a performance", async () => {
      const { ids } = await source(150 * K, [250 * K]);
      expect((await addPerformance(ids[0], 10 * K)).ok).toBe(true);
      expect(await performanceAmounts(ids[0])).toEqual([10 * K]);
    });

    it("E13: a counted performance's amount can be raised or deleted, at the limit and over it", async () => {
      for (const [contract, base] of [
        [150 * K, 150 * K], // exactly at the limit
        [150 * K, 250 * K], // already over
      ]) {
        const { ids } = await source(contract, [base]);
        expect((await addPerformance(ids[0], 10 * K)).ok).toBe(true);
        const [performanceId] = await performanceIds(ids[0]);
        expect(
          (await saveLineItemPerformanceAction({ id: performanceId, name: "Summer show", amount: dollars(25 * K), date: todayIso() }))
            .ok,
        ).toBe(true);
        expect(await performanceAmounts(ids[0])).toEqual([25 * K]);
        expect((await deleteLineItemPerformanceAction(performanceId)).ok).toBe(true);
        expect(await performanceIds(ids[0])).toEqual([]);
      }
    });

    it("E13b: a migrated performance (already inside the contract value) can be deleted at the limit", async () => {
      const { orgId, ids } = await source(150 * K, [140 * K]);
      const [migrated] = await db
        .insert(lineItemPerformances)
        .values({ orgId, lineItemId: ids[0], name: "Performance Grant", date: todayIso(), amountCents: 10 * K, sortOrder: 0 })
        .returning({ id: lineItemPerformances.id });
      expect(await deleteLineItemPerformanceAction(migrated.id)).toEqual({ ok: true, data: undefined });
      expect(await performanceIds(ids[0])).toEqual([]);
    });
  });

  describe("ownership and stale pages (regression guards)", () => {
    it("E23: another organization's funding source is refused, nothing written", async () => {
      const other = await source(0, []);
      const { fundingSourceId } = await source(150 * K, []);
      // Signed in to the second org, posting the first org's source id.
      expect(await add(other.fundingSourceId, "Probe", 1 * K)).toEqual({ ok: false, error: "Choose a funding source." });
      expect(await basesOf(other.fundingSourceId)).toHaveLength(0);
      expect(await basesOf(fundingSourceId)).toHaveLength(0);
    });

    it("E24: an edit of a line item deleted since the page loaded says so", async () => {
      const { fundingSourceId, ids } = await source(150 * K, [100 * K]);
      await db.delete(lineItems).where(eq(lineItems.id, ids[0]));
      expect(await edit(fundingSourceId, ids[0], "Item 1", 1 * K)).toEqual({
        ok: false,
        error: "That line item no longer exists.",
      });
    });
  });

  describe("the edit's own line item", () => {
    it("an edit posting another funding source of the same org says the line item no longer exists; nothing changes", async () => {
      const { orgId, fundingSourceId, ids } = await source(150 * K, [100 * K]);
      const [second] = await db
        .insert(fundingSources)
        .values({ orgId, name: "Second", type: "grant", sortOrder: 1, taxReimbursable: false, feesReimbursable: true })
        .returning({ id: fundingSources.id });
      expect(await edit(second.id, ids[0], "Moved?", 1 * K)).toEqual({
        ok: false,
        error: "That line item no longer exists.",
      });
      expect(await basesOf(fundingSourceId)).toEqual([{ name: "Item 1", cents: 100 * K, opening: 0 }]);
    });

    it("an edit waits for a delete of its line item being saved, then says it no longer exists (never 'saved')", async () => {
      const { fundingSourceId, ids } = await source(150 * K, [100 * K]);
      const { result, blocked } = await holdOpen(
        (tx) => tx.delete(lineItems).where(eq(lineItems.id, ids[0])),
        () => edit(fundingSourceId, ids[0], "Item 1", 90 * K),
      );
      expect(blocked).toBe(true);
      expect(result).toEqual({ ok: false, error: "That line item no longer exists." });
    });
  });

  describe("races (row lock on the funding source)", () => {
    it("E21: a raise waits for a contract value cut being saved, then is refused on the new total", async () => {
      const { orgId, fundingSourceId } = await source(150 * K, [100 * K]);
      const { result, blocked } = await holdOpen(
        (tx) =>
          tx
            .update(fundingSources)
            .set({ contractValueCents: 100 * K })
            .where(and(eq(fundingSources.id, fundingSourceId), eq(fundingSources.orgId, orgId))),
        () => add(fundingSourceId, "New", 50 * K),
      );
      expect(blocked).toBe(true);
      expect(result).toEqual({ ok: false, error: UI.fundingLimitExceeded("$150,000.00", "$100,000.00") });
      expect(await basesOf(fundingSourceId)).toHaveLength(1);
    });

    it("E55: an add waits for an archive of its source being saved, then is refused (R14.3)", async () => {
      const { fundingSourceId } = await source(0, []);
      const { result, blocked } = await holdOpen(
        (tx) => tx.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, fundingSourceId)),
        () => add(fundingSourceId, "New", 1 * K),
      );
      expect(blocked).toBe(true);
      expect(result).toEqual({ ok: false, error: ARCHIVED });
      expect(await basesOf(fundingSourceId)).toHaveLength(0);
    });

    it("E54: an add and an archive holding the org lock queue instead of deadlocking", async () => {
      // The archive path (Settings, billing sync) locks the organization FOR UPDATE and then
      // updates the source. The add must wait on the organization first; if it took the source
      // first, the archive's update would wait on it while it waited on the organization.
      const { orgId, fundingSourceId } = await source(0, []);

      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let ready!: (pid: number) => void;
      const isReady = new Promise<number>((resolve) => (ready = resolve));
      const archive = db.transaction(async (tx) => {
        const [{ pid }] = (await tx.execute(sql`select pg_backend_pid() as pid`)).rows as Array<{ pid: number }>;
        await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId)).for("update");
        ready(pid);
        await released;
        await tx.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, fundingSourceId));
      });
      const archivePid = await isReady;

      let finished = false;
      const pending = add(fundingSourceId, "New", 1 * K).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      void pending.then(() => (finished = true));

      let blocked = false;
      for (let waited = 0; !finished && !blocked && waited < 10_000; waited += 20) {
        const { rows } = await db.execute(
          sql`select 1 from pg_stat_activity where ${archivePid}::int = any(pg_blocking_pids(pid)) limit 1`,
        );
        blocked = rows.length > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);

      release();
      await expect(archive).resolves.toBeUndefined(); // no deadlock error on the archive side
      const outcome = await pending;
      expect(outcome).toEqual({ ok: true, value: { ok: false, error: ARCHIVED } });
      expect(await basesOf(fundingSourceId)).toHaveLength(0);
    });
  });
});
