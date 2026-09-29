/**
 * Phase 0 fixes in the line item actions, against a real database:
 * - B5: deleting a line item deletes only what the person confirmed. A confirmation that no
 *   longer matches (a recurring item added since the dialog) asks again and deletes nothing.
 * - B6: the same name saved twice at once gives one success and one friendly refusal.
 * - B8: a reorder must name every line item of the source exactly once, and two at once finish
 *   with one of the two orders, never a mix or a deadlock.
 *
 * Races are forced with `holdOpen` (the other person's change held uncommitted in a second
 * connection while the action runs); the two-reorders check also runs several rounds. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ROUNDS = 8;

describe.skipIf(!hasDatabase)("line item actions under concurrency (integration, Phase 0)", async () => {
  const { db } = await import("@/src/db");
  const { lineItems, organizations, recurringItems } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { holdOpen } = await import("@/src/db/hold-open.test-helper");
  const { UI } = await import("@/src/domain/strings");
  const { actionSession } = await import("@/src/lib/action-session");
  const { deleteLineItemAction, reorderLineItemsAction, saveLineItemAction } = await import("./actions");

  const session = vi.mocked(actionSession);
  let orgId: string;
  let fundingSourceId: string;

  beforeAll(async () => {
    const org = await createTestOrg({ name: `Phase 0 line items ${Date.now()}` });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  beforeEach(() => {
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
  });

  async function lineItem(name: string, sortOrder = 0) {
    const [row] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name, scheduledValueCents: 100_000, sortOrder })
      .returning({ id: lineItems.id });
    return row.id;
  }

  async function recurringOn(lineItemId: string, name: string) {
    await db.insert(recurringItems).values({ orgId, lineItemId, name, amountCents: 1_000, sortOrder: 0 });
  }

  const exists = async (id: string) => (await db.select().from(lineItems).where(eq(lineItems.id, id))).length === 1;

  describe("B5: delete removes only what was confirmed", () => {
    it("asks again, with the new list, when a recurring item was added after the dialog; deletes nothing", async () => {
      const id = await lineItem(`B5 stale ${Date.now()}`);
      await recurringOn(id, "Rent");
      const asked = await deleteLineItemAction(id, false);
      if (!asked.ok) throw new Error(asked.error);
      const shown = asked.data.requiresConfirmation!;
      expect(shown.recurringNames).toEqual(["Rent"]);

      // Someone else adds "Parking" and is still saving it when this person clicks Delete: the
      // delete must wait for it and then count it, not delete it unseen.
      const { result: confirmed, blocked } = await holdOpen(
        (tx) => tx.insert(recurringItems).values({ orgId, lineItemId: id, name: "Parking", amountCents: 1_000, sortOrder: 1 }),
        () => deleteLineItemAction(id, shown),
      );
      expect(blocked).toBe(true); // it waited for the recurring item's save, then counted it
      expect(confirmed).toEqual({
        ok: true,
        data: { requiresConfirmation: { recurringNames: expect.arrayContaining(["Rent", "Parking"]), performanceTotalCents: 0 } },
      });
      expect(await exists(id)).toBe(true);
    });

    it("deletes once the list confirmed is the list that would go", async () => {
      const id = await lineItem(`B5 match ${Date.now()}`);
      await recurringOn(id, "Rent");
      const asked = await deleteLineItemAction(id, false);
      if (!asked.ok) throw new Error(asked.error);

      expect(await deleteLineItemAction(id, asked.data.requiresConfirmation!)).toEqual({ ok: true, data: {} });
      expect(await exists(id)).toBe(false);
      expect(await db.select().from(recurringItems).where(eq(recurringItems.lineItemId, id))).toEqual([]);
    });

    it("refuses a bare `true` from a page loaded before this change: never deletes, never says it did", async () => {
      const id = await lineItem(`B5 legacy ${Date.now()}`);
      // An ok answer here made the old page show "Line item deleted." (PR #25 review).
      expect(await deleteLineItemAction(id, true as never)).toEqual({ ok: false, error: UI.lineItemDeleteReload });
      expect(await deleteLineItemAction(id, { recurringNames: "Rent" } as never)).toEqual({
        ok: false,
        error: UI.lineItemDeleteReload,
      });
      expect(await exists(id)).toBe(true);
    });
  });

  it("B6: a line item name another save is still taking is refused with the friendly message", async () => {
    const name = `B6 line ${Date.now()}`;
    const { result, blocked } = await holdOpen(
      (tx) => tx.insert(lineItems).values({ orgId, fundingSourceId, name, scheduledValueCents: 1, sortOrder: 99 }),
      () => saveLineItemAction({ fundingSourceId, name, scheduledValue: "100.00", openingBilled: "" }),
    );
    expect(blocked).toBe(true);
    expect(result).toEqual({ ok: false, error: UI.lineItemDuplicate });
  });

  describe("B8: reorder", () => {
    async function freshSource() {
      await db.delete(lineItems).where(eq(lineItems.fundingSourceId, fundingSourceId));
      return [await lineItem("R1", 0), await lineItem("R2", 1), await lineItem("R3", 2)];
    }
    const order = async () =>
      (
        await db
          .select({ id: lineItems.id })
          .from(lineItems)
          .where(eq(lineItems.fundingSourceId, fundingSourceId))
          .orderBy(asc(lineItems.sortOrder))
      ).map((row) => row.id);
    const STALE = UI.lineItemOrderStale;

    it("refuses part of the list, a repeated id, or an extra one, and changes nothing", async () => {
      const [a, b, c] = await freshSource();
      expect(await reorderLineItemsAction([b, a], fundingSourceId)).toEqual({ ok: false, error: STALE });
      expect(await reorderLineItemsAction([b, b, c], fundingSourceId)).toEqual({ ok: false, error: STALE });
      expect(await reorderLineItemsAction([c, b, a, crypto.randomUUID()], fundingSourceId)).toEqual({ ok: false, error: STALE });
      expect(await order()).toEqual([a, b, c]);
    });

    it("refuses a full-length list with another source's line item swapped in (PR #25)", async () => {
      const [a, b, c] = await freshSource();
      const other = await createTestOrg({ name: `B8 other ${Date.now()}` });
      const [foreign] = await db
        .insert(lineItems)
        .values({ orgId: other.orgId, fundingSourceId: other.fundingSourceId, name: "Foreign", scheduledValueCents: 1, sortOrder: 0 })
        .returning({ id: lineItems.id });
      try {
        expect(await reorderLineItemsAction([c, b, foreign.id], fundingSourceId)).toEqual({ ok: false, error: STALE });
        expect(await order()).toEqual([a, b, c]);
      } finally {
        await db.delete(organizations).where(eq(organizations.id, other.orgId));
      }
    });

    it("does not wait for an expense or draft being saved on one of the line items", async () => {
      const [a, b, c] = await freshSource();
      // What an invoice import holds while it saves: a key-share lock on a line item. The reorder
      // used to take FOR UPDATE, which waited for that and could deadlock with the import.
      const { result, blocked } = await holdOpen(
        (tx) => tx.select({ id: lineItems.id }).from(lineItems).where(eq(lineItems.id, c)).for("key share"),
        () => reorderLineItemsAction([c, a, b], fundingSourceId),
      );
      expect(blocked).toBe(false);
      expect(result.ok).toBe(true);
    });

    it("waits for another reorder in flight, then applies its own whole order", async () => {
      const [a, b, c] = await freshSource();
      const { result, blocked } = await holdOpen(
        (tx) => tx.select({ id: lineItems.id }).from(lineItems).where(eq(lineItems.id, a)).for("no key update"),
        () => reorderLineItemsAction([b, c, a], fundingSourceId),
      );
      expect(blocked).toBe(true);
      expect(result.ok).toBe(true);
      expect(await order()).toEqual([b, c, a]);
    });

    it("two reorders at once both finish, and the result is exactly one of the two orders", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const [a, b, c] = await freshSource();
        const first = [c, b, a];
        const second = [b, c, a];
        const results = await Promise.all([
          reorderLineItemsAction(first, fundingSourceId),
          reorderLineItemsAction(second, fundingSourceId),
        ]);
        expect(results.every((result) => result.ok)).toBe(true);
        expect([first, second]).toContainEqual(await order());
      }
    });

    it("a full reorder of the source's line items is saved", async () => {
      const [a, b, c] = await freshSource();
      expect(await reorderLineItemsAction([c, a, b], fundingSourceId)).toEqual({ ok: true, data: undefined });
      expect(await order()).toEqual([c, a, b]);
      const other = await db.select().from(lineItems).where(and(eq(lineItems.orgId, orgId), eq(lineItems.fundingSourceId, fundingSourceId)));
      expect(other).toHaveLength(3);
    });
  });
});
