/**
 * A line item deleted while something is being saved on it (PR #25 review, R9.3).
 *
 * Deleting a line item locks its row first, so a save that points at it waits for the delete and
 * then finds it gone. Each save path must answer that with a message, not an error page. The
 * delete here is held uncommitted in a second connection (`holdOpen`) while the save runs, and
 * the test proves the save actually waited on it, so none of this can pass by timing luck.
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => {
  const session = vi.fn();
  return { actionSession: session, actionSessionAnyPlan: session, requireAdmin: session };
});

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("a line item deleted mid-save (integration, PR #25)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, lineItemPerformances, lineItems, organizations, paymentSources, recurringItems, users, vendorDefaults } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { holdOpen } = await import("@/src/db/hold-open.test-helper");
  const { UI } = await import("@/src/domain/strings");
  const { actionSession } = await import("@/src/lib/action-session");
  const { createExpenseAction } = await import("@/src/modules/expenses/actions");
  const { addRecurringToMonthAction, saveRecurringItemAction } = await import("@/src/modules/recurring/actions");
  const { saveVendorAction } = await import("@/src/modules/settings/actions");
  const { addLineItemPerformanceAction } = await import("./actions");

  const session = vi.mocked(actionSession);
  const MONTH = "2099-03";
  let orgId: string;
  let fundingSourceId: string;
  let userId: string;

  beforeAll(async () => {
    const org = await createTestOrg({ name: `Deleted mid-save ${Date.now()}` });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;
    await db.insert(paymentSources).values({ orgId, label: "Cash", sortOrder: 0 });
    // A real person: expense saves write a history entry naming who did it.
    const [user] = await db
      .insert(users)
      .values({ orgId, email: `mid-save-${Date.now()}@example.test`, passwordHash: "unused", role: "admin" })
      .returning({ id: users.id });
    userId = user.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  beforeEach(() => {
    session.mockResolvedValue({
      orgId,
      userId,
      email: "e@example.com",
      role: "admin",
      orgName: "Org",
      docName: "Doc",
      activeMonth: MONTH,
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    });
  });

  async function lineItem(name: string) {
    const [row] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: `${name} ${Date.now()}`, scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    return row.id;
  }

  /** Someone else's delete of `id`, still in progress while the save runs. */
  const deleting = (id: string) => (tx: Parameters<Parameters<typeof holdOpen>[0]>[0]) =>
    tx.delete(lineItems).where(eq(lineItems.id, id));

  it("saving an expense on it: waits, then says so, and saves nothing", async () => {
    const id = await lineItem("Expense");
    const { result, blocked } = await holdOpen(deleting(id), () =>
      createExpenseAction({
        name: "Mid-save expense",
        fundingSourceId,
        lineItemId: id,
        paymentSource: "Cash",
        taxReimbursable: false,
        feesReimbursable: true,
        month: MONTH,
        date: `${MONTH}-05`,
        description: "",
        subtotal: "10.00",
        tax: "",
        fees: "",
        note: "",
        narrative: "A narrative.",
        noReceipt: false,
        noReceiptReason: "",
      }),
    );
    expect(blocked).toBe(true);
    expect(result).toEqual({ ok: false, error: UI.lineItemGone });
    expect(await db.select().from(expenses).where(eq(expenses.name, "Mid-save expense"))).toEqual([]);
  });

  it("adding a recurring item to the month: waits, then says so", async () => {
    const id = await lineItem("Recurring add");
    const [item] = await db
      .insert(recurringItems)
      .values({ orgId, lineItemId: id, name: "Mid-save rent", amountCents: 1_000, sortOrder: 0 })
      .returning({ id: recurringItems.id });
    const { result, blocked } = await holdOpen(deleting(id), () => addRecurringToMonthAction(item.id, MONTH));
    expect(blocked).toBe(true);
    expect(result).toEqual({ ok: false, error: UI.lineItemGone });
    expect(await db.select().from(expenses).where(eq(expenses.name, "Mid-save rent"))).toEqual([]);
  });

  it("saving a recurring template on it: waits, then says so", async () => {
    const id = await lineItem("Recurring save");
    const { result, blocked } = await holdOpen(deleting(id), () =>
      saveRecurringItemAction({
        name: "Mid-save template",
        amount: "12.00",
        lineItemId: id,
        defaultDescription: "",
        defaultNarrative: "",
        defaultPaymentSource: "",
        defaultTax: "",
        defaultFees: "",
      }),
    );
    expect(blocked).toBe(true);
    expect(result).toEqual({ ok: false, error: UI.lineItemGone });
    expect(await db.select().from(recurringItems).where(eq(recurringItems.name, "Mid-save template"))).toEqual([]);
  });

  it("adding a performance to it: waits, then says the line item no longer exists", async () => {
    const id = await lineItem("Performance");
    const { result, blocked } = await holdOpen(deleting(id), () =>
      addLineItemPerformanceAction({ lineItemId: id, name: "Mid-save show", amount: "500.00", date: `${MONTH}-10` }),
    );
    expect(blocked).toBe(true);
    expect(result).toEqual({ ok: false, error: "That line item no longer exists." });
    expect(await db.select().from(lineItemPerformances).where(eq(lineItemPerformances.name, "Mid-save show"))).toEqual([]);
  });

  it("B3: a vendor's default line item deleted mid-save: waits, then says so, and keeps the old default", async () => {
    const id = await lineItem("Vendor default");
    const [vendor] = await db
      .insert(vendorDefaults)
      .values({ orgId, name: `Mid-save vendor ${Date.now()}`, defaultDescription: "" })
      .returning({ id: vendorDefaults.id, name: vendorDefaults.name });
    const { result, blocked } = await holdOpen(deleting(id), () =>
      saveVendorAction({
        id: vendor.id,
        name: vendor.name,
        defaultLineItemId: id,
        defaultDescription: "",
        defaultPaymentSource: null,
        defaultSubtotal: "",
        defaultTax: "",
        defaultFees: "",
      }),
    );
    expect(blocked).toBe(true);
    expect(result).toEqual({ ok: false, error: UI.lineItemGone });
    const [row] = await db
      .select({ defaultLineItemId: vendorDefaults.defaultLineItemId })
      .from(vendorDefaults)
      .where(and(eq(vendorDefaults.id, vendor.id), eq(vendorDefaults.orgId, orgId)));
    expect(row.defaultLineItemId).toBeNull();
  });
});
