/**
 * `removeRecurringFromMonthAction` and the D-79 fix.
 *
 * The reported bug: creating a recurring item that happens to share a name and line item
 * with an expense the user typed in by hand made the Recurring screen show that expense as
 * "already added," and Remove could delete it — a record the recurring item never created.
 * Confirmed live: Metro Parking, $180, May 2026, re-entered by hand after the packet had
 * already gone to DCC.
 *
 * First fix (this session, earlier): route the delete through soft delete instead of a hard
 * delete, so the record was at least recoverable from the trash. That was not enough — the
 * expense still left its month the moment "Remove anyway" was confirmed. The actual fix:
 * Remove now refuses outright on an expense it did not create. No confirmation is offered for
 * that case at all, so there is no click that can move or delete it — it stays in its
 * original month, with its attachments, completely untouched.
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
  const {
    expenseDocuments,
    expenses,
    lineItems,
    organizations,
    paymentSources,
    recurringItems,
    users,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { actionSession } = await import("@/src/lib/action-session");
  const { saveRecurringItemAction, removeRecurringFromMonthAction } = await import("./actions");
  const { loadTrashedExpenses } = await import("@/src/modules/expenses/queries");

  const session = vi.mocked(actionSession);

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let userId: string;
  const MONTH = "2099-08";

  function asOrg(id: string) {
    session.mockResolvedValue({
      orgId: id,
      userId,
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
    const org = await createTestOrg({ name: "Remove-From-Month Org", docName: "RFM", activeMonth: MONTH });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Parking", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    await db.insert(paymentSources).values({ orgId, label: "Cash", sortOrder: 0 });

    // A real users row — expenses.created_by_user_id/updated_by_user_id (D-89) are a real
    // FK, so the mocked session's userId has to point at one.
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `admin-${Date.now()}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    userId = user.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("refuses to touch an expense matched only by name — it stays active, in its month, untouched", async () => {
    asOrg(orgId);

    // Hand-typed directly — no recurring item involved.
    const [handTyped] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId,
        month: MONTH,
        date: `${MONTH}-10`,
        name: "Metro Parking",
        paymentSource: "Cash",
        subtotalCents: 5000,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, fundingSourceId, MONTH),
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

    // No confirmation offered at all — the action refuses outright, unconfirmed.
    const unconfirmed = await removeRecurringFromMonthAction(recurringItem.id, MONTH, false);
    expect(unconfirmed.ok).toBe(false);
    if (unconfirmed.ok) throw new Error("unreachable");
    expect(unconfirmed.error).toContain("Metro Parking");
    expect(unconfirmed.error).toContain("wasn't added from this recurring item");

    // Confirmed does not bypass the refusal — there is no click sequence that deletes it.
    const confirmed = await removeRecurringFromMonthAction(recurringItem.id, MONTH, true);
    expect(confirmed.ok).toBe(false);

    // Still exactly as it was: active, in its original month, not even soft-deleted.
    const [row] = await db.select().from(expenses).where(eq(expenses.id, handTyped.id));
    expect(row).toBeDefined();
    expect(row.deletedAt).toBeNull();
    expect(row.month).toBe(MONTH);
    expect(row.subtotalCents).toBe(5000);

    // Never even reached the trash.
    const trashed = await loadTrashedExpenses(orgId, fundingSourceId);
    expect(trashed.map((entry) => entry.id)).not.toContain(handTyped.id);
  });

  it("leaves attached documents untouched on the same refusal", async () => {
    asOrg(orgId);

    const [expense] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId,
        month: MONTH,
        date: `${MONTH}-11`,
        name: "Metro Parking With Receipt",
        paymentSource: "Cash",
        subtotalCents: 5000,
        sortOrder: 1,
        referenceSeq: await claimReferenceSeq(orgId, fundingSourceId, MONTH),
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

    const result = await removeRecurringFromMonthAction(recurringItem.id, MONTH, true);
    expect(result.ok).toBe(false);

    const docs = await db
      .select()
      .from(expenseDocuments)
      .where(eq(expenseDocuments.expenseId, expense.id));
    expect(docs).toHaveLength(1); // still there — the action never touched the expense at all

    const [row] = await db.select().from(expenses).where(eq(expenses.id, expense.id));
    expect(row.deletedAt).toBeNull();
  });

  it("still removes (soft-deletes) an expense the recurring item actually created", async () => {
    asOrg(orgId);

    await saveRecurringItemAction({
      name: "Genuine One-Click Add",
      amount: "75.00",
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
      .where(and(eq(recurringItems.orgId, orgId), eq(recurringItems.name, "Genuine One-Click Add")));

    const { addRecurringToMonthAction } = await import("./actions");
    const added = await addRecurringToMonthAction(recurringItem.id, MONTH);
    expect(added.ok).toBe(true);

    const [createdExpense] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.name, "Genuine One-Click Add")));

    // No confirmation needed — freshly created, no documents.
    const result = await removeRecurringFromMonthAction(recurringItem.id, MONTH, false);
    expect(result.ok).toBe(true);

    const [row] = await db.select().from(expenses).where(eq(expenses.id, createdExpense.id));
    expect(row.deletedAt).not.toBeNull(); // this one Remove is genuinely allowed to touch

    const trashed = await loadTrashedExpenses(orgId, fundingSourceId);
    expect(trashed.map((entry) => entry.id)).toContain(createdExpense.id);
  });

  it("review fix: Remove on the old template cannot reach an expense that was since moved to another source", async () => {
    // Exact reported scenario: a recurring template on source A creates an expense in August.
    // Someone edits that expense and moves it to source B — but it was still linked to
    // source A's template (recurringItemId untouched by the move). Clicking Remove on the
    // template in source A for August then trashed the expense sitting in source B.
    asOrg(orgId);

    const { fundingSources } = await import("@/src/db/schema");
    const [sourceB] = await db
      .insert(fundingSources)
      .values({
        orgId,
        name: "Other Source",
        type: "grant",
        sortOrder: 1,
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: fundingSources.id });
    const [itemB] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceB.id, name: "Other Item", scheduledValueCents: 100_000, sortOrder: 1 })
      .returning({ id: lineItems.id });

    await saveRecurringItemAction({
      name: "Moved After Add",
      amount: "40.00",
      lineItemId,
      defaultDescription: "",
      defaultNarrative: "",
      defaultPaymentSource: "Cash",
      defaultTax: "",
      defaultFees: "",
    });
    const [template] = await db
      .select({ id: recurringItems.id })
      .from(recurringItems)
      .where(and(eq(recurringItems.orgId, orgId), eq(recurringItems.name, "Moved After Add")));

    const { addRecurringToMonthAction } = await import("./actions");
    const added = await addRecurringToMonthAction(template.id, MONTH);
    expect(added.ok).toBe(true);

    const [createdExpense] = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.name, "Moved After Add")));
    expect(createdExpense.recurringItemId).toBe(template.id);
    expect(createdExpense.fundingSourceId).toBe(fundingSourceId);

    // Move it to source B by editing it — this is what should clear recurringItemId.
    const { updateExpenseAction } = await import("@/src/modules/expenses/actions");
    const moved = await updateExpenseAction({
      id: createdExpense.id,
      name: createdExpense.name,
      fundingSourceId: sourceB.id,
      lineItemId: itemB.id,
      paymentSource: createdExpense.paymentSource,
      taxReimbursable: createdExpense.taxReimbursable,
      feesReimbursable: createdExpense.feesReimbursable,
      month: MONTH,
      date: createdExpense.date,
      description: createdExpense.description,
      subtotal: (createdExpense.subtotalCents / 100).toFixed(2),
      tax: "0.00",
      fees: "0.00",
      note: "",
      narrative: "Moved to the other source.",
      noReceipt: true,
      noReceiptReason: "n/a",
    });
    expect(moved.ok).toBe(true);

    const [afterMove] = await db.select().from(expenses).where(eq(expenses.id, createdExpense.id));
    expect(afterMove.fundingSourceId).toBe(sourceB.id);
    // The link to the old template is gone — this is the actual fix, not just the query scope
    // below, which is defence in depth for exactly the case where this ever regressed.
    expect(afterMove.recurringItemId).toBeNull();

    // Remove on the OLD template, for the SAME month, must not touch the moved expense.
    const removeResult = await removeRecurringFromMonthAction(template.id, MONTH, true);
    expect(removeResult.ok).toBe(false);

    const [untouched] = await db.select().from(expenses).where(eq(expenses.id, createdExpense.id));
    expect(untouched.deletedAt).toBeNull();
    expect(untouched.fundingSourceId).toBe(sourceB.id);
  });
});
