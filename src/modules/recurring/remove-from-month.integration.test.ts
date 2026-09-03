/**
 * `removeRecurringFromMonthAction` and soft delete.
 *
 * The reported bug: creating a recurring item that happens to share a name and line item
 * with an expense the user typed in by hand made the Recurring screen show that expense as
 * "already added," and confirming Remove permanently, unrecoverably deleted it — a record
 * the recurring item never created. Fixed by routing this action's delete through the same
 * soft-delete path the main expenses list uses, so it lands in the trash instead of vanishing.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("removeRecurringFromMonthAction (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDocuments, expenses, lineItems, organizations, paymentSources, recurringItems } =
    await import("@/src/db/schema");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { actionSession } = await import("@/src/lib/action-session");
  const { saveRecurringItemAction, removeRecurringFromMonthAction } = await import("./actions");
  const { loadTrashedExpenses } = await import("@/src/modules/expenses/queries");

  const session = vi.mocked(actionSession);

  let orgId: string;
  let lineItemId: string;
  const MONTH = "2099-08";

  function asOrg(id: string) {
    session.mockResolvedValue({
      orgId: id,
      userId: "u",
      email: "e@example.com",
      orgName: "Org",
      docName: "Doc",
      activeMonth: MONTH,
      onboarded: true,
      welcomeDismissed: true,
    });
  }

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Remove-From-Month Org", docName: "RFM", activeMonth: MONTH })
      .returning({ id: organizations.id });
    orgId = org.id;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, name: "Parking", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    await db.insert(paymentSources).values({ orgId, label: "Cash", sortOrder: 0 });
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("soft-deletes (never hard-deletes) an expense matched only by name, and it's recoverable from the trash", async () => {
    asOrg(orgId);

    // Hand-typed directly — no recurring item involved.
    const [handTyped] = await db
      .insert(expenses)
      .values({
        orgId,
        lineItemId,
        month: MONTH,
        date: `${MONTH}-10`,
        name: "Metro Parking",
        paymentSource: "Cash",
        subtotalCents: 5000,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, MONTH),
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: expenses.id });

    // Created afterward, with the same name and line item — never touched the hand-typed row.
    await saveRecurringItemAction({
      name: "Metro Parking",
      amount: "50.00",
      lineItemId,
      defaultDescription: "",
      defaultNarrative: "",
      defaultPaymentSource: "Cash",
      defaultTax: "",
      defaultFees: "",
    });
    const [recurringItem] = await db
      .select({ id: recurringItems.id })
      .from(recurringItems)
      .where(eq(recurringItems.orgId, orgId));

    // Requires confirmation first, exactly as the UI does before actually removing.
    const asked = await removeRecurringFromMonthAction(recurringItem.id, MONTH, false);
    expect(asked.ok).toBe(true);
    if (!asked.ok) throw new Error("unreachable");
    expect(asked.data.requiresConfirmation).toBeDefined();
    expect(asked.data.createdByThisItem).toBe(false);

    // Confirmed, as if the user clicked "Remove anyway".
    const result = await removeRecurringFromMonthAction(recurringItem.id, MONTH, true);
    expect(result.ok).toBe(true);

    // Gone from the active list...
    const [row] = await db.select().from(expenses).where(eq(expenses.id, handTyped.id));
    expect(row).toBeDefined(); // the row itself still exists in the table
    expect(row.deletedAt).not.toBeNull(); // ...because it's soft-deleted, not hard-deleted

    // ...and recoverable from the trash, unlike before this fix.
    const trashed = await loadTrashedExpenses(orgId);
    expect(trashed.map((entry) => entry.id)).toContain(handTyped.id);
  });

  it("leaves attached documents untouched, since this is now a soft delete", async () => {
    asOrg(orgId);

    const [expense] = await db
      .insert(expenses)
      .values({
        orgId,
        lineItemId,
        month: MONTH,
        date: `${MONTH}-11`,
        name: "Metro Parking With Receipt",
        paymentSource: "Cash",
        subtotalCents: 5000,
        sortOrder: 1,
        referenceSeq: await claimReferenceSeq(orgId, MONTH),
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: expenses.id });

    await db.insert(expenseDocuments).values({
      orgId,
      expenseId: expense.id,
      kind: "receipt",
      status: "attached",
      s3Key: `org/${orgId}/rfm-test/${expense.id}/doc.pdf`,
      filename: "receipt.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      sortOrder: 0,
    });

    await saveRecurringItemAction({
      name: "Metro Parking With Receipt",
      amount: "50.00",
      lineItemId,
      defaultDescription: "",
      defaultNarrative: "",
      defaultPaymentSource: "Cash",
      defaultTax: "",
      defaultFees: "",
    });
    const [recurringItem] = await db
      .select({ id: recurringItems.id })
      .from(recurringItems)
      .where(and(eq(recurringItems.orgId, orgId), eq(recurringItems.name, "Metro Parking With Receipt")));

    await removeRecurringFromMonthAction(recurringItem.id, MONTH, true);

    const docs = await db
      .select()
      .from(expenseDocuments)
      .where(eq(expenseDocuments.expenseId, expense.id));
    expect(docs).toHaveLength(1); // still there — soft delete never touches documents
  });
});
