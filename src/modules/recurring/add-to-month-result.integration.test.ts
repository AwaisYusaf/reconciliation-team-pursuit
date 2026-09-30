/**
 * `addRecurringToMonthAction` now hands back the created expense's id and what it still needs
 * (usability #44), and resolves its payment source through `recurringPaymentSource`, the same
 * function the form's "Use the default" hint calls (#43). The expense itself is created exactly
 * as before: no documents (R4.5).
 *
 * Real database, mocked session. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("addRecurringToMonthAction result (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDocuments, expenses, fundingSources, lineItems, organizations, paymentSources, recurringItems, users } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { currentMonthKey, monthLabel, shiftMonth } = await import("@/src/domain/dates");
  const { UI } = await import("@/src/domain/strings");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  const { addRecurringToMonthAction } = await import("./actions");

  const session = vi.mocked(actionSession);
  // Next month, so no real packet lock or submission for this month can exist on a fresh org.
  const MONTH = shiftMonth(currentMonthKey(), 1);

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let userId: string;

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Add-To-Month Result Org", activeMonth: MONTH });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;
    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Software", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;
    // Sort order decides the fallback: "Cash" is first even though it was inserted second.
    await db.insert(paymentSources).values([
      { orgId, label: "Zelle", sortOrder: 1 },
      { orgId, label: "Cash", sortOrder: 0 },
      { orgId, label: "Old card", sortOrder: 2, active: false },
    ]);
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `atm-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    userId = user.id;
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

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  async function template(values: { name: string; defaultNarrative: string | null; defaultPaymentSource?: string | null }) {
    const [row] = await db
      .insert(recurringItems)
      .values({ orgId, lineItemId, amountCents: 4_999, defaultPaymentSource: null, ...values })
      .returning({ id: recurringItems.id });
    return row.id;
  }

  /** The action's result, asserted successful, plus the one expense it created. */
  async function add(recurringId: string) {
    const result = await addRecurringToMonthAction(recurringId, MONTH);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const created = await db.select().from(expenses).where(eq(expenses.recurringItemId, recurringId));
    expect(created).toHaveLength(1);
    const documents = await db
      .select({ id: expenseDocuments.id })
      .from(expenseDocuments)
      .where(eq(expenseDocuments.expenseId, created[0].id));
    return { data: result.data, expense: created[0], documentCount: documents.length };
  }

  it("E20: a template with a narrative still needs proof and a receipt; the id is the created expense's; no documents (R4.5)", async () => {
    const { data, expense, documentCount } = await add(
      await template({ name: "Adobe", defaultNarrative: "Monthly retainer." }),
    );

    expect(data.missing).toEqual(["proof", "receipt"]);
    expect(data.id).toBe(expense.id);
    expect(documentCount).toBe(0);
    expect(expense.narrative).toBe("Monthly retainer.");
    expect(expense.month).toBe(MONTH);
    expect(expense.subtotalCents).toBe(4_999);
    expect(UI.recurringAdded("Adobe", monthLabel(MONTH), data.missing)).toBe(
      `Adobe added to ${monthLabel(MONTH)}. It's still missing proof of payment and a receipt.`,
    );
  });

  it("E21: a template with no narrative also needs a narrative", async () => {
    const { data, expense, documentCount } = await add(await template({ name: "Zoom", defaultNarrative: null }));

    expect(data.missing).toEqual(["proof", "receipt", "narrative"]);
    expect(data.id).toBe(expense.id);
    expect(documentCount).toBe(0);
    expect(UI.recurringAdded("Zoom", monthLabel(MONTH), data.missing)).toBe(
      `Zoom added to ${monthLabel(MONTH)}. It's still missing proof of payment, a receipt, and a narrative.`,
    );
  });

  it("E22: a whitespace-only narrative counts as missing", async () => {
    const { data } = await add(await template({ name: "Slack", defaultNarrative: "   " }));
    expect(data.missing).toEqual(["proof", "receipt", "narrative"]);
  });

  it("E24 through the action: a retired remembered source falls back to the first active one by sort order", async () => {
    const { expense } = await add(
      await template({ name: "Retired Source Item", defaultNarrative: "x", defaultPaymentSource: "Old card" }),
    );
    expect(expense.paymentSource).toBe("Cash");
  });

  it("E24 through the action: an active remembered source that is not first is kept", async () => {
    const { expense } = await add(
      await template({ name: "Zelle Item", defaultNarrative: "x", defaultPaymentSource: "Zelle" }),
    );
    expect(expense.paymentSource).toBe("Zelle");
  });

  it("E24 through the action: no remembered source uses the first active one", async () => {
    const { expense } = await add(await template({ name: "Default Source Item", defaultNarrative: "x" }));
    expect(expense.paymentSource).toBe("Cash");
  });

  it("E23: a refusal is unchanged, carries no data, and writes nothing", async () => {
    const [archived] = await db
      .insert(fundingSources)
      .values({
        orgId,
        name: "Archived Source",
        type: "grant",
        sortOrder: 5,
        taxReimbursable: false,
        feesReimbursable: true,
        archivedAt: new Date(),
      })
      .returning({ id: fundingSources.id });
    const [archivedItem] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: archived.id, name: "Archived LI", scheduledValueCents: 1_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    const [row] = await db
      .insert(recurringItems)
      .values({ orgId, lineItemId: archivedItem.id, name: "On Archived", amountCents: 100, defaultNarrative: "x" })
      .returning({ id: recurringItems.id });

    const result = await addRecurringToMonthAction(row.id, MONTH);

    expect(result).toEqual({
      ok: false,
      error: "That funding source is archived. Unarchive it in Settings to add expenses to it.",
    });
    expect(await db.select().from(expenses).where(eq(expenses.recurringItemId, row.id))).toHaveLength(0);
    // A foreign/unknown id is refused the same way as before, too.
    expect(await addRecurringToMonthAction("00000000-0000-0000-0000-000000000000", MONTH)).toEqual({
      ok: false,
      error: "That recurring item no longer exists.",
    });
  });
});
