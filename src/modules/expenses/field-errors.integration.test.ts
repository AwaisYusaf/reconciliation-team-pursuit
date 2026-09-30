/**
 * `createExpenseAction` / `updateExpenseAction` return every validation problem in one result,
 * keyed by field (usability #24, #25), and their two DB refusals (line item, payment source)
 * name the field they belong to. A non-UUID line item id never reaches Postgres (22P02 would
 * throw instead of returning an ActionResult).
 *
 * Real database, mocked session. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("expense save returns every field error at once (integration)", async () => {
  const { db } = await import("@/src/db");
  const {
    expenseDocuments,
    expenses,
    fundingSources,
    lineItems,
    monthStatuses,
    organizations,
    paymentSources,
    users,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { currentMonthKey, monthLabel } = await import("@/src/domain/dates");
  const { UI } = await import("@/src/domain/strings");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  const { createExpenseAction, updateExpenseAction } = await import("./actions");

  const session = vi.mocked(actionSession);
  const MONTH = currentMonthKey();

  const createdOrgIds: string[] = [];
  afterAll(async () => {
    for (const id of createdOrgIds) await db.delete(organizations).where(eq(organizations.id, id));
  });

  function asOrg(orgId: string, userId: string) {
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
  }

  type Input = Parameters<typeof createExpenseAction>[0];

  function input(overrides: Partial<Input>): Input {
    return {
      name: "Test expense",
      fundingSourceId: "",
      lineItemId: "",
      paymentSource: "Cash",
      taxReimbursable: false,
      feesReimbursable: true,
      month: MONTH,
      date: `${MONTH}-05`,
      description: "",
      subtotal: "10.00",
      tax: "0.00",
      fees: "0.00",
      note: "",
      narrative: "A narrative.",
      noReceipt: false,
      noReceiptReason: "",
      ...overrides,
    };
  }

  /** Two sources, one line item each, an active "Cash" and a retired "Old card". */
  async function org(name: string) {
    const created = await createTestOrg({ name, activeMonth: MONTH });
    createdOrgIds.push(created.orgId);
    const orgId = created.orgId;
    const sourceA = created.fundingSourceId;
    const [b] = await db
      .insert(fundingSources)
      .values({ orgId, name: "Source B", type: "grant", sortOrder: 1, taxReimbursable: true, feesReimbursable: false })
      .returning({ id: fundingSources.id });
    const [itemA] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceA, name: "A item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    const [itemB] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: b.id, name: "B item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    await db.insert(paymentSources).values([
      { orgId, label: "Cash", sortOrder: 0 },
      { orgId, label: "Old card", sortOrder: 1, active: false },
    ]);
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `fe-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    return { orgId, userId: user.id, sourceA, sourceB: b.id, itemA: itemA.id, itemB: itemB.id };
  }

  async function expenseCount(orgId: string) {
    return (await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.orgId, orgId))).length;
  }

  /** Locks a (source, month) the way the packet's Lock month does: `month_statuses.locked_at`. */
  async function lockMonth(orgId: string, fundingSourceId: string, month: string) {
    await db
      .insert(monthStatuses)
      .values({ orgId, fundingSourceId, month, lockedAt: new Date() })
      .onConflictDoUpdate({
        target: [monthStatuses.orgId, monthStatuses.fundingSourceId, monthStatuses.month],
        set: { lockedAt: new Date() },
      });
  }

  /** What a request built by something other than the form can send. Each is refused before any
   *  rule reads it: "false" is truthy, and `.trim()` on a number throws. */
  const MALFORMED: Record<string, unknown>[] = [
    { noReceipt: "false", noReceiptReason: "Lost" },
    { noReceipt: true, noReceiptReason: 42 },
    { name: 7 },
    { narrative: null },
    { subtotal: 12.5 },
    { taxReimbursable: "true" },
  ];
  const REFUSED = { ok: false, error: UI.requestRefused };

  const LINE_ITEM_REFUSAL = { ok: false, error: "Choose a line item.", fieldErrors: { lineItemId: "Choose a line item." } };
  const PAYMENT_REFUSAL = {
    ok: false,
    error: "Choose a payment source.",
    fieldErrors: { paymentSource: "Choose a payment source." },
  };

  describe("createExpenseAction", () => {
    it("E1: an empty add form gets name, line item, payment source and narrative errors in one result; nothing written", async () => {
      const o = await org("FE Create Empty Org");
      asOrg(o.orgId, o.userId);

      const result = await createExpenseAction(
        input({ fundingSourceId: o.sourceA, name: "", lineItemId: "", paymentSource: "", narrative: "" }),
      );

      expect(result).toEqual({
        ok: false,
        error: `Enter a name. Choose a line item. Choose a payment source. ${UI.expenseMissingNarrative}`,
        fieldErrors: {
          name: "Enter a name.",
          lineItemId: "Choose a line item.",
          paymentSource: "Choose a payment source.",
          narrative: UI.expenseMissingNarrative,
        },
      });
      expect(await expenseCount(o.orgId)).toBe(0);
    });

    it("E4: no receipt without a reason and a blank narrative come back together; nothing written", async () => {
      const o = await org("FE Create NoReceipt Org");
      asOrg(o.orgId, o.userId);

      const result = await createExpenseAction(
        input({ fundingSourceId: o.sourceA, lineItemId: o.itemA, noReceipt: true, noReceiptReason: "", narrative: " " }),
      );

      expect(result).toEqual({
        ok: false,
        error: `${UI.noReceiptReasonRequired} ${UI.expenseMissingNarrative}`,
        fieldErrors: { noReceiptReason: UI.noReceiptReasonRequired, narrative: UI.expenseMissingNarrative },
      });
      expect(await expenseCount(o.orgId)).toBe(0);
    });

    it("E6: a non-UUID line item is refused with its field error, without throwing; nothing written", async () => {
      const o = await org("FE Create NonUuid Org");
      asOrg(o.orgId, o.userId);

      const result = await createExpenseAction(input({ fundingSourceId: o.sourceA, lineItemId: "not-a-uuid" }));

      expect(result).toEqual(LINE_ITEM_REFUSAL);
      expect(await expenseCount(o.orgId)).toBe(0);
    });

    it("E7: another source's line item, and another org's, are refused with the line item field error", async () => {
      const o = await org("FE Create Foreign Org");
      const other = await org("FE Create Foreign Other Org");
      asOrg(o.orgId, o.userId);

      expect(await createExpenseAction(input({ fundingSourceId: o.sourceA, lineItemId: o.itemB }))).toEqual(
        LINE_ITEM_REFUSAL,
      );
      expect(await createExpenseAction(input({ fundingSourceId: o.sourceA, lineItemId: other.itemA }))).toEqual(
        LINE_ITEM_REFUSAL,
      );
      expect(await expenseCount(o.orgId)).toBe(0);
      expect(await expenseCount(other.orgId)).toBe(0);
    });

    it("E8: a retired or unknown payment source is refused with the payment source field error", async () => {
      const o = await org("FE Create Retired Org");
      asOrg(o.orgId, o.userId);

      for (const label of ["Old card", "Never offered"]) {
        const result = await createExpenseAction(
          input({ fundingSourceId: o.sourceA, lineItemId: o.itemA, paymentSource: label }),
        );
        expect(result).toEqual(PAYMENT_REFUSAL);
      }
      expect(await expenseCount(o.orgId)).toBe(0);
    });

    it("E9: an archived funding source is still one panel message, with no field errors", async () => {
      const o = await org("FE Create Archived Org");
      await db.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, o.sourceA));
      asOrg(o.orgId, o.userId);

      const result = await createExpenseAction(input({ fundingSourceId: o.sourceA, lineItemId: o.itemA }));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toMatch(/archived/i);
      expect(result.fieldErrors).toBeUndefined();
      expect(await expenseCount(o.orgId)).toBe(0);
    });

    it("a locked month is one panel message in exactly this shape, with no field errors; nothing written", async () => {
      const o = await org("FE Create Locked Org");
      await lockMonth(o.orgId, o.sourceA, MONTH);
      asOrg(o.orgId, o.userId);

      const result = await createExpenseAction(input({ fundingSourceId: o.sourceA, lineItemId: o.itemA }));

      expect(result).toEqual({ ok: false, error: UI.monthLocked(monthLabel(MONTH)) });
      expect(await expenseCount(o.orgId)).toBe(0);
    });

    it("a request whose field types aren't the form's is refused as one panel message, never read or thrown; nothing written", async () => {
      const o = await org("FE Create Malformed Org");
      asOrg(o.orgId, o.userId);
      const valid = input({ fundingSourceId: o.sourceA, lineItemId: o.itemA });

      for (const overrides of MALFORMED) {
        const result = await createExpenseAction({ ...valid, ...overrides } as unknown as Input);
        expect(result, JSON.stringify(overrides)).toEqual(REFUSED);
      }
      expect(await createExpenseAction(null as unknown as Input)).toEqual(REFUSED);
      expect(await expenseCount(o.orgId)).toBe(0);
    });

    it("a valid input still saves (the refusals above are not refusing everything)", async () => {
      const o = await org("FE Create Valid Org");
      asOrg(o.orgId, o.userId);

      const result = await createExpenseAction(input({ fundingSourceId: o.sourceA, lineItemId: o.itemA }));

      expect(result.ok).toBe(true);
      expect(await expenseCount(o.orgId)).toBe(1);
    });
  });

  describe("updateExpenseAction", () => {
    async function savedExpense(name: string) {
      const o = await org(name);
      asOrg(o.orgId, o.userId);
      const created = await createExpenseAction(input({ fundingSourceId: o.sourceA, lineItemId: o.itemA }));
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("unreachable");
      return { ...o, id: created.data.id };
    }

    async function row(id: string) {
      const [found] = await db.select().from(expenses).where(eq(expenses.id, id));
      return found;
    }

    it("E6: a non-UUID line item is refused with its field error, without throwing; the row is unchanged", async () => {
      const e = await savedExpense("FE Update NonUuid Org");
      const before = await row(e.id);

      const result = await updateExpenseAction(
        input({ id: e.id, fundingSourceId: e.sourceA, lineItemId: "not-a-uuid", name: "Changed name" }),
      );

      expect(result).toEqual(LINE_ITEM_REFUSAL);
      const after = await row(e.id);
      expect(after.name).toBe(before.name);
      expect(after.lineItemId).toBe(e.itemA);
    });

    it("E7: rebinding to another source's line item is refused with the line item field error", async () => {
      const e = await savedExpense("FE Update Foreign Org");

      const result = await updateExpenseAction(input({ id: e.id, fundingSourceId: e.sourceA, lineItemId: e.itemB }));

      expect(result).toEqual(LINE_ITEM_REFUSAL);
      expect((await row(e.id)).lineItemId).toBe(e.itemA);
    });

    it("E10: a legacy expense with no narrative, edited with it still blank, gets the narrative field error", async () => {
      const e = await savedExpense("FE Update Legacy Org");
      await db.update(expenses).set({ narrative: null }).where(eq(expenses.id, e.id));

      const result = await updateExpenseAction(
        input({ id: e.id, fundingSourceId: e.sourceA, lineItemId: e.itemA, narrative: "", name: "Changed name" }),
      );

      expect(result).toEqual({
        ok: false,
        error: UI.expenseMissingNarrative,
        fieldErrors: { narrative: UI.expenseMissingNarrative },
      });
      const after = await row(e.id);
      expect(after.name).toBe("Test expense");
      expect(after.narrative).toBeNull();
    });

    it("a locked month is one panel message in exactly this shape, with no field errors; the row is unchanged", async () => {
      const e = await savedExpense("FE Update Locked Org");
      await lockMonth(e.orgId, e.sourceA, MONTH);

      const result = await updateExpenseAction(
        input({ id: e.id, fundingSourceId: e.sourceA, lineItemId: e.itemA, name: "Changed name" }),
      );

      expect(result).toEqual({ ok: false, error: UI.monthLocked(monthLabel(MONTH)) });
      expect((await row(e.id)).name).toBe("Test expense");
    });

    it('"false" for No receipt is refused, never read as ticked: the receipt stays, and so does the row', async () => {
      const e = await savedExpense("FE Update Malformed Org");
      await db.insert(expenseDocuments).values({
        orgId: e.orgId,
        expenseId: e.id,
        kind: "receipt",
        status: "attached",
        s3Key: `test/${e.id}/receipt`,
        filename: "receipt.pdf",
        mimeType: "application/pdf",
      });
      const valid = input({ id: e.id, fundingSourceId: e.sourceA, lineItemId: e.itemA, name: "Changed name" });

      for (const overrides of MALFORMED) {
        const result = await updateExpenseAction({ ...valid, ...overrides } as unknown as Input);
        expect(result, JSON.stringify(overrides)).toEqual(REFUSED);
      }
      expect(await updateExpenseAction(null as unknown as Input)).toEqual({
        ok: false,
        error: "That expense no longer exists.",
      });
      const after = await row(e.id);
      expect(after.name).toBe("Test expense");
      expect(after.noReceipt).toBe(false);
      const receipts = await db
        .select({ id: expenseDocuments.id })
        .from(expenseDocuments)
        .where(eq(expenseDocuments.expenseId, e.id));
      expect(receipts).toHaveLength(1);
    });

    it("E8: changing to a retired payment source is refused with its field error; keeping one it already has is not", async () => {
      const e = await savedExpense("FE Update Retired Org");

      const refused = await updateExpenseAction(
        input({ id: e.id, fundingSourceId: e.sourceA, lineItemId: e.itemA, paymentSource: "Old card" }),
      );
      expect(refused).toEqual(PAYMENT_REFUSAL);
      expect((await row(e.id)).paymentSource).toBe("Cash");

      // Retire the label the expense already carries: an unchanged value is still accepted (R5.2).
      await db.update(paymentSources).set({ active: false }).where(eq(paymentSources.orgId, e.orgId));
      const kept = await updateExpenseAction(
        input({ id: e.id, fundingSourceId: e.sourceA, lineItemId: e.itemA, name: "Renamed" }),
      );
      expect(kept.ok).toBe(true);
      expect((await row(e.id)).name).toBe("Renamed");
    });
  });
});
