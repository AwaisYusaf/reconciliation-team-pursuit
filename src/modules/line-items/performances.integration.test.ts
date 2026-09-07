/**
 * `addLineItemPerformanceAction` / `deleteLineItemPerformanceAction` against a real database
 * (m08).
 *
 * The Performance Grant used to be one hand-maintained figure in Settings (R7.2). It is now
 * built from performances added directly to a line item, each rolling into that line item's
 * effective Scheduled Value via `loadLineItemBudgets` — this proves that roundtrip actually
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
  const { loadLineItemBudgets } = await import("@/src/db/queries");
  const { actionSession } = await import("@/src/lib/action-session");
  const {
    addLineItemPerformanceAction,
    deleteLineItemPerformanceAction,
    deleteLineItemAction,
  } = await import("./actions");

  const session = vi.mocked(actionSession);

  let orgId: string;
  let otherOrgId: string;
  let lineItemId: string;

  function asOrg(id: string) {
    session.mockResolvedValue({
      orgId: id,
      userId: "u",
      email: "e@example.com",
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2026-02",
      onboarded: true,
      welcomeDismissed: true,
    });
  }

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "m08 Performances Org", docName: "Perf", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    orgId = org.id;
    const [other] = await db
      .insert(organizations)
      .values({ name: "m08 Performances Other Org", docName: "Other", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    otherOrgId = other.id;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, name: "Performance Grant 1", scheduledValueCents: 0, sortOrder: 0 })
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
      const result = await addLineItemPerformanceAction(lineItemId, bad);
      expect(result.ok).toBe(false);
    }
    const [{ scheduledValueCents }] = await loadLineItemBudgets(orgId);
    expect(scheduledValueCents).toBe(0);
  });

  it("refuses to add a performance to another organisation's line item", async () => {
    asOrg(otherOrgId);
    const result = await addLineItemPerformanceAction(lineItemId, "100.00");
    expect(result.ok).toBe(false);
  });

  it("adding a performance rolls straight into the line item's effective Scheduled Value", async () => {
    asOrg(orgId);
    const first = await addLineItemPerformanceAction(lineItemId, "175000.00");
    expect(first.ok).toBe(true);

    const [budget] = await loadLineItemBudgets(orgId);
    expect(budget.scheduledValueCents).toBe(17500000);
    // The performance-only slice (D-81) — what a renderer needs to show the split — read back
    // from the database alongside the combined total, not just derived in a test fixture.
    expect(budget.performanceCents).toBe(17500000);

    const second = await addLineItemPerformanceAction(lineItemId, "25000.00");
    expect(second.ok).toBe(true);

    const [afterSecond] = await loadLineItemBudgets(orgId);
    expect(afterSecond.scheduledValueCents).toBe(20000000);
    expect(afterSecond.performanceCents).toBe(20000000);
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

    const [budget] = await loadLineItemBudgets(orgId);
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
    const [budget] = await loadLineItemBudgets(orgId);
    expect(budget.scheduledValueCents).toBe(17500000); // untouched
  });

  it("names the performance total in the delete-confirmation message, then cascades on confirm", async () => {
    asOrg(orgId);
    const asked = await deleteLineItemAction(lineItemId, false);
    expect(asked.ok).toBe(true);
    if (!asked.ok) throw new Error("unreachable");
    expect(asked.data.requiresConfirmation?.performanceTotalCents).toBe(17500000);

    const confirmed = await deleteLineItemAction(lineItemId, true);
    expect(confirmed.ok).toBe(true);

    // Cascade-deleted with the line item (FK onDelete: "cascade") — nothing orphaned.
    const remaining = await db
      .select()
      .from(lineItemPerformances)
      .where(eq(lineItemPerformances.lineItemId, lineItemId));
    expect(remaining).toHaveLength(0);
  });
});
