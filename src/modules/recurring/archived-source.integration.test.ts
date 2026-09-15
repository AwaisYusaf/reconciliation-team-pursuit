/**
 * Archived funding sources take no new expenses or templates (Phase 6, D-93 review fix).
 *
 * `saveRecurringItemAction` creates/edits a *template*, and `addRecurringToMonthAction` uses
 * one to insert an expense — both must refuse once the line item's funding source is archived,
 * exactly like `createExpenseAction` already does, and must write nothing when they refuse.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("recurring actions refuse archived funding sources (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, fundingSources, lineItems, organizations, recurringItems } = await import(
    "@/src/db/schema"
  );
  const { createTestOrg } = await import("@/src/db/test-org");
  const { actionSession } = await import("@/src/lib/action-session");
  const { saveRecurringItemAction, addRecurringToMonthAction } = await import("./actions");

  const session = vi.mocked(actionSession);

  let orgId: string;
  let activeSourceId: string;
  let archivedSourceId: string;
  let activeLineItemId: string;
  let archivedLineItemId: string;
  const MONTH = "2099-09";

  function asOrg() {
    session.mockResolvedValue({
      orgId,
      userId: "u",
      email: "e@example.com",
      role: "admin",
      orgName: "Org",
      docName: "Doc",
      activeMonth: MONTH,
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
    });
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Archived Source Recurring Org", activeMonth: MONTH });
    orgId = org.orgId;
    activeSourceId = org.fundingSourceId;

    const [archived] = await db
      .insert(fundingSources)
      .values({
        orgId,
        name: "Archived Grant",
        type: "grant",
        sortOrder: 1,
        taxReimbursable: false,
        feesReimbursable: true,
        archivedAt: new Date(),
      })
      .returning({ id: fundingSources.id });
    archivedSourceId = archived.id;

    const [activeItem] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: activeSourceId, name: "Active Line", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    activeLineItemId = activeItem.id;

    const [archivedItem] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: archivedSourceId, name: "Archived Line", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    archivedLineItemId = archivedItem.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  beforeEach(() => {
    asOrg();
  });

  describe("saveRecurringItemAction", () => {
    it("refuses to create a template on an archived source's line item, and writes nothing", async () => {
      const before = await db
        .select({ id: recurringItems.id })
        .from(recurringItems)
        .where(eq(recurringItems.orgId, orgId));

      const result = await saveRecurringItemAction({
        name: "Archived Template",
        amount: "50.00",
        lineItemId: archivedLineItemId,
        defaultDescription: "",
        defaultNarrative: "",
        defaultPaymentSource: "",
        defaultTax: "",
        defaultFees: "",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("That funding source is archived.");

      const after = await db
        .select({ id: recurringItems.id })
        .from(recurringItems)
        .where(eq(recurringItems.orgId, orgId));
      expect(after).toHaveLength(before.length);
    });

    it("still allows creating a template on an active source's line item", async () => {
      const result = await saveRecurringItemAction({
        name: "Active Template",
        amount: "50.00",
        lineItemId: activeLineItemId,
        defaultDescription: "",
        defaultNarrative: "",
        defaultPaymentSource: "",
        defaultTax: "",
        defaultFees: "",
      });

      expect(result.ok).toBe(true);
      const [row] = await db
        .select({ id: recurringItems.id })
        .from(recurringItems)
        .where(and(eq(recurringItems.orgId, orgId), eq(recurringItems.name, "Active Template")));
      expect(row).toBeDefined();
    });

    it("refuses to update an existing template's line item to point at an archived source", async () => {
      const created = await saveRecurringItemAction({
        name: "Movable Template",
        amount: "25.00",
        lineItemId: activeLineItemId,
        defaultDescription: "",
        defaultNarrative: "",
        defaultPaymentSource: "",
        defaultTax: "",
        defaultFees: "",
      });
      expect(created.ok).toBe(true);
      const [row] = await db
        .select({ id: recurringItems.id, lineItemId: recurringItems.lineItemId })
        .from(recurringItems)
        .where(and(eq(recurringItems.orgId, orgId), eq(recurringItems.name, "Movable Template")));

      const result = await saveRecurringItemAction({
        id: row.id,
        name: "Movable Template",
        amount: "25.00",
        lineItemId: archivedLineItemId,
        defaultDescription: "",
        defaultNarrative: "",
        defaultPaymentSource: "",
        defaultTax: "",
        defaultFees: "",
      });
      expect(result.ok).toBe(false);

      const [unchanged] = await db
        .select({ lineItemId: recurringItems.lineItemId })
        .from(recurringItems)
        .where(eq(recurringItems.id, row.id));
      expect(unchanged.lineItemId).toBe(activeLineItemId);
    });
  });

  describe("addRecurringToMonthAction", () => {
    it("refuses to add to the month when the recurring item's line item is on an archived source, and inserts no expense", async () => {
      const created = await saveRecurringItemAction({
        name: "Archived Add Attempt",
        amount: "40.00",
        lineItemId: activeLineItemId,
        defaultDescription: "",
        defaultNarrative: "",
        defaultPaymentSource: "",
        defaultTax: "",
        defaultFees: "",
      });
      expect(created.ok).toBe(true);
      const [item] = await db
        .select({ id: recurringItems.id })
        .from(recurringItems)
        .where(and(eq(recurringItems.orgId, orgId), eq(recurringItems.name, "Archived Add Attempt")));

      // Move the template's line item to the archived source directly (bypassing the action's
      // own guard above) so addRecurringToMonthAction is the thing under test here.
      await db
        .update(recurringItems)
        .set({ lineItemId: archivedLineItemId })
        .where(eq(recurringItems.id, item.id));

      const beforeCount = await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.orgId, orgId), eq(expenses.month, MONTH)));

      const result = await addRecurringToMonthAction(item.id, MONTH);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("That funding source is archived.");

      const afterCount = await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.orgId, orgId), eq(expenses.month, MONTH)));
      expect(afterCount).toHaveLength(beforeCount.length);
    });

    it("still adds to the month when the recurring item's line item is on an active source", async () => {
      const created = await saveRecurringItemAction({
        name: "Active Add Success",
        amount: "40.00",
        lineItemId: activeLineItemId,
        defaultDescription: "",
        defaultNarrative: "",
        defaultPaymentSource: "",
        defaultTax: "",
        defaultFees: "",
      });
      expect(created.ok).toBe(true);
      const [item] = await db
        .select({ id: recurringItems.id })
        .from(recurringItems)
        .where(and(eq(recurringItems.orgId, orgId), eq(recurringItems.name, "Active Add Success")));

      const result = await addRecurringToMonthAction(item.id, MONTH);
      expect(result.ok).toBe(true);

      const [expense] = await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.orgId, orgId), eq(expenses.name, "Active Add Success")));
      expect(expense).toBeDefined();
    });
  });
});
