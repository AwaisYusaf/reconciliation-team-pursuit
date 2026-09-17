/**
 * Soft delete for expenses (trash / restore / permanent delete).
 *
 * Drives the real server actions against a real database. `actionSession()` is mocked so
 * the test controls which organisation is "signed in" per call â€” this is what the
 * cross-org scoping tests need â€” and `next/cache`'s `revalidatePath` is stubbed because it
 * throws outside a real Next.js request (`Invariant: static generation store missing`).
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("expense trash (integration)", async () => {
  const { db } = await import("@/src/db");
  const {
    expenseDocuments,
    expenses,
    lineItems,
    organizations,
    paymentSources,
    users,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { claimReferenceSeq } = await import("./references");
  const { actionSession } = await import("@/src/lib/action-session");
  const {
    createExpenseAction,
    deleteExpenseAction,
    restoreExpenseAction,
    permanentlyDeleteExpenseAction,
  } = await import("./actions");
  const { loadExpense, loadMonthExpenses, loadTrashedExpenses } = await import("./queries");
  const { ingestExpenseDocument } = await import("@/src/services/storage/documents");
  const { loadLineItemRows } = await import("@/src/modules/line-items/queries");
  const { planLineItemDelete } = await import("@/src/domain/line-item-rules");
  const { storage } = await import("@/src/services/storage/driver");

  const session = vi.mocked(actionSession);

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let otherOrgId: string;
  let otherLineItemId: string;
  let userId: string;
  let otherUserId: string;

  const MONTH = "2099-01";

  /** A real users row per org â€” actor_user_id now carries a NOT NULL FK to it. */
  async function insertUser(orgId: string, role: "admin" | "manager" = "admin") {
    const [row] = await db
      .insert(users)
      .values({
        orgId,
        email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role,
      })
      .returning({ id: users.id });
    return row.id;
  }

  function asOrg(id: string) {
    session.mockResolvedValue({
      orgId: id,
      userId: id === otherOrgId ? otherUserId : userId,
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

  let sortCounter = 0;
  /** Insert an expense row directly, bypassing the action layer â€” setup, not the thing tested. */
  async function insertExpense(overrides: {
    orgId: string;
    lineItemId: string;
    month?: string;
    name?: string;
  }) {
    const month = overrides.month ?? MONTH;
    // The expense's source is its line item's source (Phase 6, D-93) â€” resolved here so the
    // call sites stay unchanged; this is setup, not an assertion.
    const [item] = await db
      .select({ fundingSourceId: lineItems.fundingSourceId })
      .from(lineItems)
      .where(eq(lineItems.id, overrides.lineItemId));
    const [row] = await db
      .insert(expenses)
      .values({
        orgId: overrides.orgId,
        fundingSourceId: item.fundingSourceId,
        lineItemId: overrides.lineItemId,
        month,
        date: `${month}-10`,
        name: overrides.name ?? "Test expense",
        paymentSource: "Cash",
        subtotalCents: 1000,
        sortOrder: sortCounter++,
        referenceSeq: await claimReferenceSeq(overrides.orgId, item.fundingSourceId, month),
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: expenses.id });
    return row.id;
  }

  async function rowById(id: string) {
    const [row] = await db.select().from(expenses).where(eq(expenses.id, id));
    return row ?? null;
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Trash Org", docName: "Trash", activeMonth: MONTH });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Travel", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    await db.insert(paymentSources).values({ orgId, label: "Cash", sortOrder: 0 });

    const other = await createTestOrg({ name: "Other Org", docName: "Other", activeMonth: MONTH });
    otherOrgId = other.orgId;

    const [otherItem] = await db
      .insert(lineItems)
      .values({ orgId: otherOrgId, fundingSourceId: other.fundingSourceId, name: "Other Travel", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    otherLineItemId = otherItem.id;

    userId = await insertUser(orgId);
    otherUserId = await insertUser(otherOrgId);
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      if (id) await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  describe("lifecycle", () => {
    it("trashes an active expense", async () => {
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });

      const result = await deleteExpenseAction(id);
      expect(result.ok).toBe(true);

      const row = await rowById(id);
      expect(row!.deletedAt).not.toBeNull();
    });

    it("refuses a second delete and does not overwrite the original timestamp", async () => {
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);
      const first = (await rowById(id))!.deletedAt;

      const second = await deleteExpenseAction(id);
      expect(second.ok).toBe(false);

      const after = (await rowById(id))!.deletedAt;
      expect(after?.getTime()).toBe(first?.getTime());
    });

    it("restores a trashed expense", async () => {
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      const result = await restoreExpenseAction(id);
      expect(result.ok).toBe(true);
      expect((await rowById(id))!.deletedAt).toBeNull();
    });

    it("refuses to restore an expense that was never trashed", async () => {
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });

      const result = await restoreExpenseAction(id);
      expect(result.ok).toBe(false);
      expect((await rowById(id))!.deletedAt).toBeNull();
    });

    it("refuses to permanently delete an active (never-trashed) expense, and the row survives", async () => {
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });

      const result = await permanentlyDeleteExpenseAction(id);
      expect(result.ok).toBe(false);
      expect(await rowById(id)).not.toBeNull();
    });

    it("permanently deletes a trashed expense", async () => {
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      const result = await permanentlyDeleteExpenseAction(id);
      expect(result.ok).toBe(true);
      expect(await rowById(id)).toBeNull();
    });
  });

  describe("org scoping", () => {
    it("org B cannot trash org A's expense", async () => {
      const id = await insertExpense({ orgId, lineItemId });

      asOrg(otherOrgId);
      const result = await deleteExpenseAction(id);
      expect(result.ok).toBe(false);
      expect((await rowById(id))!.deletedAt).toBeNull();
    });

    it("org B cannot restore org A's trashed expense", async () => {
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      asOrg(otherOrgId);
      const result = await restoreExpenseAction(id);
      expect(result.ok).toBe(false);
      expect((await rowById(id))!.deletedAt).not.toBeNull();
    });

    it("org B cannot permanently delete org A's trashed expense", async () => {
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      asOrg(otherOrgId);
      const result = await permanentlyDeleteExpenseAction(id);
      expect(result.ok).toBe(false);
      expect(await rowById(id)).not.toBeNull();
    });
  });

  describe("invalid ids", () => {
    it("every action fails cleanly on a non-UUID id, rather than a 500", async () => {
      asOrg(orgId);
      const bogus = "not-a-uuid";
      await expect(deleteExpenseAction(bogus)).resolves.toMatchObject({ ok: false });
      await expect(restoreExpenseAction(bogus)).resolves.toMatchObject({ ok: false });
      await expect(permanentlyDeleteExpenseAction(bogus)).resolves.toMatchObject({ ok: false });
    });

    it("every action fails cleanly on a well-formed but nonexistent UUID", async () => {
      asOrg(orgId);
      const missing = "00000000-0000-0000-0000-000000000000";
      await expect(deleteExpenseAction(missing)).resolves.toMatchObject({ ok: false });
      await expect(restoreExpenseAction(missing)).resolves.toMatchObject({ ok: false });
      await expect(permanentlyDeleteExpenseAction(missing)).resolves.toMatchObject({ ok: false });
    });
  });

  describe("documents", () => {
    async function attachDummyDocument(expenseId: string) {
      const [doc] = await db
        .insert(expenseDocuments)
        .values({
          orgId,
          expenseId,
          kind: "receipt",
          status: "attached",
          s3Key: `org/${orgId}/trash-test/${expenseId}/doc.pdf`,
          filename: "receipt.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          sortOrder: 0,
        })
        .returning({ id: expenseDocuments.id });
      return doc.id;
    }

    it("soft delete leaves expenseDocuments rows intact", async () => {
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });
      await attachDummyDocument(id);

      await deleteExpenseAction(id);

      const rows = await db
        .select()
        .from(expenseDocuments)
        .where(eq(expenseDocuments.expenseId, id));
      expect(rows).toHaveLength(1);
    });

    it("permanent delete removes expenseDocuments rows with it", async () => {
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });
      await attachDummyDocument(id);
      await deleteExpenseAction(id);

      await permanentlyDeleteExpenseAction(id);

      const rows = await db
        .select()
        .from(expenseDocuments)
        .where(eq(expenseDocuments.expenseId, id));
      expect(rows).toHaveLength(0);
    });

    it("permanent delete removes the actual stored object, not just the database row", async () => {
      // The bug this proves fixed: expenseDocuments cascades away the instant the expense
      // row is deleted (onDelete: "cascade"), so a cleanup step that looks the row back up
      // by id *after* that delete finds nothing and silently never touches storage. A real
      // object has to actually exist in the driver for that gap to be provable â€” a
      // database row with a made-up key, like `attachDummyDocument` above uses, would pass
      // even on the old, buggy code, since nothing ever checked whether the key was real.
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });
      const key = `org/${orgId}/trash-test/${id}/real-object.pdf`;
      await storage().put({ key, body: Buffer.from("not a real pdf"), contentType: "application/pdf" });
      await db.insert(expenseDocuments).values({
        orgId,
        expenseId: id,
        kind: "receipt",
        status: "attached",
        s3Key: key,
        filename: "receipt.pdf",
        mimeType: "application/pdf",
        sizeBytes: 14,
        sortOrder: 0,
      });

      expect(await storage().exists(key)).toBe(true);

      await deleteExpenseAction(id);
      await permanentlyDeleteExpenseAction(id);

      expect(await storage().exists(key)).toBe(false);
    });

    it("ingestExpenseDocument refuses a trashed expense", async () => {
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });
      await deleteExpenseAction(id);

      const result = await ingestExpenseDocument({
        orgId,
        expenseId: id,
        scope: "proof",
        file: new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }),
      });

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.error).toBe("That expense no longer exists.");

      const docs = await db
        .select()
        .from(expenseDocuments)
        .where(eq(expenseDocuments.expenseId, id));
      expect(docs).toHaveLength(0);
    });
  });

  describe("reference and sort order counters (pinned: deliberately not filtered)", () => {
    it("a new expense in the same month never reuses a trashed row's reference or sort order", async () => {
      asOrg(orgId);
      const month = "2099-02";

      const trashedId = await insertExpense({ orgId, lineItemId, month });
      const [trashedBefore] = await db
        .select({ referenceSeq: expenses.referenceSeq, sortOrder: expenses.sortOrder })
        .from(expenses)
        .where(eq(expenses.id, trashedId));
      await deleteExpenseAction(trashedId);

      // A real create, through the action, so the counter logic under test is the actual
      // production code path, not a re-implementation of it.
      const created = await createExpenseAction({
        name: "New while sibling trashed",
        fundingSourceId,
        lineItemId,
        paymentSource: "Cash",
        taxReimbursable: false,
        feesReimbursable: true,
        month,
        date: `${month}-15`,
        description: "",
        subtotal: "10.00",
        tax: "0",
        fees: "0",
        note: "",
        narrative: "New expense created while a sibling was trashed.",
        noReceipt: false,
        noReceiptReason: "",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("unreachable");

      const [newRow] = await db
        .select({ referenceSeq: expenses.referenceSeq, sortOrder: expenses.sortOrder })
        .from(expenses)
        .where(eq(expenses.id, created.data.id));

      expect(newRow.sortOrder).toBeGreaterThan(trashedBefore.sortOrder);
      expect(newRow.referenceSeq).not.toBe(trashedBefore.referenceSeq);

      // Restoring afterward must not collide with the row created while it was trashed.
      const restored = await restoreExpenseAction(trashedId);
      expect(restored.ok).toBe(true);

      const [trashedAfter] = await db
        .select({ referenceSeq: expenses.referenceSeq, sortOrder: expenses.sortOrder })
        .from(expenses)
        .where(eq(expenses.id, trashedId));
      // Restore never reassigns either counter.
      expect(trashedAfter.referenceSeq).toBe(trashedBefore.referenceSeq);
      expect(trashedAfter.sortOrder).toBe(trashedBefore.sortOrder);
      expect(trashedAfter.referenceSeq).not.toBe(newRow.referenceSeq);
    });
  });

  describe("loadExpense / loadMonthExpenses", () => {
    it("loadExpense returns null for a trashed expense, and the expense again once restored", async () => {
      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId });
      expect(await loadExpense(orgId, id)).not.toBeNull();

      await deleteExpenseAction(id);
      expect(await loadExpense(orgId, id)).toBeNull();

      await restoreExpenseAction(id);
      expect(await loadExpense(orgId, id)).not.toBeNull();
    });

    it("loadMonthExpenses excludes a trashed row and includes it again once restored", async () => {
      asOrg(orgId);
      const month = "2099-03";
      const keepId = await insertExpense({ orgId, lineItemId, month, name: "Kept" });
      const trashId = await insertExpense({ orgId, lineItemId, month, name: "Trashed" });

      await deleteExpenseAction(trashId);
      let rows = await loadMonthExpenses(orgId, fundingSourceId, month);
      expect(rows.map((row) => row.id).sort()).toEqual([keepId].sort());

      await restoreExpenseAction(trashId);
      rows = await loadMonthExpenses(orgId, fundingSourceId, month);
      expect(rows.map((row) => row.id).sort()).toEqual([keepId, trashId].sort());
    });
  });

  describe("loadTrashedExpenses", () => {
    it("is org-scoped, newest deletion first, and its amount matches reimbursableCents", async () => {
      const { reimbursableCents } = await import("@/src/domain/money");

      asOrg(orgId);
      const month = "2099-04";
      const first = await insertExpense({ orgId, lineItemId, month, name: "First trashed" });
      await deleteExpenseAction(first);
      // A real clock tick between deletions, so "newest first" is a meaningful assertion
      // rather than an accident of insertion order.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await insertExpense({ orgId, lineItemId, month, name: "Second trashed" });
      await deleteExpenseAction(second);

      const active = await insertExpense({ orgId, lineItemId, month, name: "Still active" });

      asOrg(otherOrgId);
      const otherId = await insertExpense({ orgId: otherOrgId, lineItemId: otherLineItemId, month });
      await deleteExpenseAction(otherId);

      const trashed = await loadTrashedExpenses(orgId, fundingSourceId);
      const ids = trashed.map((row) => row.id);

      expect(ids).not.toContain(active);
      expect(ids).not.toContain(otherId);
      expect(ids).toContain(first);
      expect(ids).toContain(second);
      expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(first));

      const [row] = await db.select().from(expenses).where(eq(expenses.id, first));
      const trashedRow = trashed.find((entry) => entry.id === first)!;
      expect(trashedRow.amountCents).toBe(reimbursableCents(row));
    });

    it("scopes to one month when given, for the packet page's deletion safeguard", async () => {
      asOrg(orgId);
      const monthA = "2099-05";
      const monthB = "2099-06";

      const inA = await insertExpense({ orgId, lineItemId, month: monthA, name: "Deleted in A" });
      await deleteExpenseAction(inA);
      const inB = await insertExpense({ orgId, lineItemId, month: monthB, name: "Deleted in B" });
      await deleteExpenseAction(inB);

      const scopedToA = await loadTrashedExpenses(orgId, fundingSourceId, monthA);
      expect(scopedToA.map((row) => row.id)).toEqual([inA]);

      const scopedToB = await loadTrashedExpenses(orgId, fundingSourceId, monthB);
      expect(scopedToB.map((row) => row.id)).toEqual([inB]);

      // No month given still means every month, unchanged from before this parameter existed.
      const unscoped = await loadTrashedExpenses(orgId, fundingSourceId);
      const unscopedIds = unscoped.map((row) => row.id);
      expect(unscopedIds).toContain(inA);
      expect(unscopedIds).toContain(inB);

      // A month with nothing deleted in it returns empty, not every month's rows.
      expect(await loadTrashedExpenses(orgId, fundingSourceId, "2099-07")).toEqual([]);
    });
  });

  describe("line-item delete gate (pinned: expense counts ignore trash)", () => {
    it("a trashed expense still counts toward loadLineItemRows and blocks the delete plan", async () => {
      const [item] = await db
        .insert(lineItems)
        .values({ orgId, fundingSourceId, name: "Blocked by trash", scheduledValueCents: 1000, sortOrder: 5 })
        .returning({ id: lineItems.id });

      asOrg(orgId);
      const id = await insertExpense({ orgId, lineItemId: item.id, name: "Will be trashed" });
      await deleteExpenseAction(id);

      const rows = await loadLineItemRows(orgId, fundingSourceId);
      const row = rows.find((r) => r.id === item.id)!;
      expect(row.expenseCount).toBe(1);
      expect(planLineItemDelete({ ...row, performanceTotalCents: 0 }).allowed).toBe(false);

      // And the database itself refuses the delete via the restrict FK â€” deleting the trash
      // is not enough to bypass it without going through permanent delete first.
      const rejection = await db
        .delete(lineItems)
        .where(eq(lineItems.id, item.id))
        .then(() => null)
        .catch((error: unknown) => error);
      expect(rejection).toBeInstanceOf(Error);
      const cause = (rejection as Error & { cause?: { code?: string } }).cause;
      expect(cause?.code).toBe("23503");

      // Clean up: permanently delete the expense so the line item can be removed.
      await permanentlyDeleteExpenseAction(id);
      await db.delete(lineItems).where(eq(lineItems.id, item.id));
    });
  });
});
