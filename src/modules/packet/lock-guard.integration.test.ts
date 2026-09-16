/**
 * Every write path refuses a locked month (R10.7, D-96) â€” `docs/PHASE-8.md` Â§8 Phase 1.
 *
 * Table-driven over the Â§2 write table: each row is refused on a locked month with the exact
 * `UI.monthLocked` message and leaves every row it would have touched untouched. Each row also
 * proves the guard is actually load-bearing by temporarily replacing `monthLocked` with a
 * stub that always says "not locked", confirming the write then succeeds, before restoring it.
 *
 * Two more scenarios that only make sense once the table above exists: the open-page case (a
 * stale read, saved after the month locks under it) and the race (a concurrent save blocked on
 * the same row lock the guard takes).
 *
 * Kept separate from `lock.integration.test.ts`, which does not need to touch `monthLocked`
 * itself. Locks here are set directly on `month_statuses` (`lockDirectly`) rather than through
 * `lockMonth` â€” `lockMonth`'s own correctness (blocking documents, PDF-only, quota, the
 * Submitted interplay) is already proven there; this file is only about what a locked row does
 * to every *other* write.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));
vi.mock("@/src/modules/packet/month-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/modules/packet/month-guard")>();
  return { ...actual, monthLocked: vi.fn(actual.monthLocked) };
});
vi.mock("@/src/modules/recurring/narrative", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/modules/recurring/narrative")>();
  return { ...actual, carryNarrativeToTemplate: vi.fn(actual.carryNarrativeToTemplate) };
});
vi.mock("@/src/services/storage/inspect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/services/storage/inspect")>();
  return { ...actual, inspectUpload: vi.fn(actual.inspectUpload) };
});

config({ path: ".env.local", quiet: true });

import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("every write path refuses a locked month (integration, R10.7)", async () => {
  const { db } = await import("@/src/db");
  const {
    expenseAuditEvents,
    expenseDocuments,
    expenses,
    fundingSources,
    lineItems,
    monthDocuments,
    monthSnapshotTotals,
    monthStatuses,
    organizations,
    paymentSources,
    recurringItems,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { monthLabel } = await import("@/src/domain/dates");
  const { UI } = await import("@/src/domain/strings");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { actionSession } = await import("@/src/lib/action-session");
  const { monthLocked } = await import("@/src/modules/packet/month-guard");
  const { carryNarrativeToTemplate } = await import("@/src/modules/recurring/narrative");
  const { inspectUpload } = await import("@/src/services/storage/inspect");

  const {
    createExpenseAction,
    updateExpenseAction,
    deleteExpenseAction,
    restoreExpenseAction,
    permanentlyDeleteExpenseAction,
    removeExpenseDocumentAction,
  } = await import("@/src/modules/expenses/actions");
  const { addRecurringToMonthAction, removeRecurringFromMonthAction } = await import(
    "@/src/modules/recurring/actions"
  );
  const { removeMonthDocumentAction, markMonthSubmittedAction } = await import("./actions");
  const { ingestExpenseDocument, ingestMonthDocument } = await import("@/src/services/storage/documents");
  const { storage } = await import("@/src/services/storage/driver");

  const actionSessionMock = vi.mocked(actionSession);
  const guardSpy = vi.mocked(monthLocked);
  const narrativeSpy = vi.mocked(carryNarrativeToTemplate);
  const inspectSpy = vi.mocked(inspectUpload);

  let orgId: string;
  let sourceA: string;
  let sourceB: string;
  let itemA: string;
  let itemB: string;
  let userId: string;

  function sessionContext() {
    return {
      orgId,
      userId,
      email: "e@example.com",
      role: "admin" as const,
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2094-01",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    };
  }
  function asUser() {
    actionSessionMock.mockResolvedValue(sessionContext());
  }

  let monthCounter = 0;
  function freshMonth(): string {
    monthCounter += 1;
    const month = 1 + (monthCounter % 12);
    const year = 2094 + Math.floor(monthCounter / 12);
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  async function lockDirectly(sourceId: string, month: string) {
    await db
      .insert(monthStatuses)
      .values({ orgId, fundingSourceId: sourceId, month, lockedAt: new Date() })
      .onConflictDoUpdate({
        target: [monthStatuses.orgId, monthStatuses.fundingSourceId, monthStatuses.month],
        set: { lockedAt: new Date() },
      });
  }

  async function insertExpenseDirect(sourceId: string, itemId: string, month: string, overrides: Partial<{
    name: string;
    deletedAt: Date | null;
    recurringItemId: string | null;
  }> = {}) {
    const [row] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId: sourceId,
        lineItemId: itemId,
        month,
        date: `${month}-05`,
        name: overrides.name ?? "Direct expense",
        narrative: "n",
        paymentSource: "Cash",
        subtotalCents: 1_000,
        taxReimbursable: false,
        feesReimbursable: true,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, sourceId, month),
        deletedAt: overrides.deletedAt ?? null,
        recurringItemId: overrides.recurringItemId ?? null,
      })
      .returning({ id: expenses.id });
    return row.id;
  }

  async function nextRefSeqOf(sourceId: string, month: string): Promise<number | null> {
    const [row] = await db
      .select({ next: monthStatuses.nextReferenceSeq })
      .from(monthStatuses)
      .where(
        and(
          eq(monthStatuses.orgId, orgId),
          eq(monthStatuses.fundingSourceId, sourceId),
          eq(monthStatuses.month, month),
        ),
      )
      .limit(1);
    return row?.next ?? null;
  }

  async function expenseRow(id: string) {
    const [row] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
    return row;
  }

  async function monthStatusOf(sourceId: string, month: string) {
    const [row] = await db
      .select({ lockedAt: monthStatuses.lockedAt, submittedAt: monthStatuses.submittedAt })
      .from(monthStatuses)
      .where(
        and(
          eq(monthStatuses.orgId, orgId),
          eq(monthStatuses.fundingSourceId, sourceId),
          eq(monthStatuses.month, month),
        ),
      )
      .limit(1);
    return row;
  }

  async function snapshotCapturedAtOf(sourceId: string, month: string) {
    const [row] = await db
      .select({ capturedAt: monthSnapshotTotals.capturedAt })
      .from(monthSnapshotTotals)
      .where(
        and(
          eq(monthSnapshotTotals.orgId, orgId),
          eq(monthSnapshotTotals.fundingSourceId, sourceId),
          eq(monthSnapshotTotals.month, month),
        ),
      )
      .limit(1);
    return row?.capturedAt ?? null;
  }

  const validExpenseInput = (overrides: Partial<Record<string, unknown>> = {}) => ({
    name: "Guard test",
    fundingSourceId: sourceA,
    lineItemId: itemA,
    paymentSource: "Cash",
    taxReimbursable: false,
    feesReimbursable: true,
    month: "2094-01",
    date: "2094-01-06",
    description: "",
    subtotal: "1.00",
    tax: "0.00",
    fees: "0.00",
    note: "",
    narrative: "narrative",
    noReceipt: true,
    noReceiptReason: "n/a",
    ...overrides,
  });

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Guard Org", activeMonth: "2094-01" });
    orgId = org.orgId;
    sourceA = org.fundingSourceId;

    const [row] = await db
      .insert((await import("@/src/db/schema")).users)
      .values({
        orgId,
        email: `guard-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: (await import("@/src/db/schema")).users.id });
    userId = row.id;

    const [b] = await db
      .insert(fundingSources)
      .values({ orgId, name: "Source B", type: "donation", sortOrder: 1, taxReimbursable: false, feesReimbursable: true })
      .returning({ id: fundingSources.id });
    sourceB = b.id;

    await db.insert(paymentSources).values({ orgId, label: "Cash", sortOrder: 0 });

    const [ia] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceA, name: "A item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    itemA = ia.id;

    const [ib] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceB, name: "B item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    itemB = ib.id;
  }, 30_000);

  afterAll(async () => {
    if (orgId) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
      const { rm } = await import("node:fs/promises");
      const path = await import("node:path");
      await rm(path.join(process.cwd(), ".storage", "org", orgId), { recursive: true, force: true });
    }
  });

  it("create expense: refused into a locked month, nothing created; guard proven by disabling it", async () => {
    const month = freshMonth();
    await lockDirectly(sourceA, month);
    asUser();

    const beforeRef = await nextRefSeqOf(sourceA, month);
    const result = await createExpenseAction(validExpenseInput({ month, date: `${month}-06` }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const rows = await db.select().from(expenses).where(and(eq(expenses.orgId, orgId), eq(expenses.month, month)));
    expect(rows).toHaveLength(0);
    expect(await nextRefSeqOf(sourceA, month)).toBe(beforeRef);

    // Prove the guard is load-bearing: disable it once, the same write now succeeds.
    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await createExpenseAction(validExpenseInput({ month, date: `${month}-06` }));
    expect(bypassed.ok).toBe(true);
  });

  it("edit in place: refused on a locked month, name unchanged; guard proven", async () => {
    const month = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month, { name: "Original" });
    await lockDirectly(sourceA, month);
    asUser();

    const result = await updateExpenseAction(
      validExpenseInput({ id, month, date: `${month}-06`, name: "Renamed" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const row = await expenseRow(id);
    expect(row.name).toBe("Original");

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await updateExpenseAction(
      validExpenseInput({ id, month, date: `${month}-06`, name: "Renamed" }),
    );
    expect(bypassed.ok).toBe(true);
  });

  it("move INTO a locked month: refused naming the locked target, expense stays put; guard proven", async () => {
    const openMonth = freshMonth();
    const lockedMonth = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, openMonth);
    await lockDirectly(sourceA, lockedMonth);
    asUser();

    const beforeRef = await nextRefSeqOf(sourceA, lockedMonth);
    const result = await updateExpenseAction(
      validExpenseInput({ id, month: lockedMonth, date: `${lockedMonth}-06` }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(lockedMonth)));

    const row = await expenseRow(id);
    expect(row.month).toBe(openMonth);
    expect(await nextRefSeqOf(sourceA, lockedMonth)).toBe(beforeRef);

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await updateExpenseAction(
      validExpenseInput({ id, month: lockedMonth, date: `${lockedMonth}-06` }),
    );
    expect(bypassed.ok).toBe(true);
  });

  it("move OUT of a locked month: refused naming the locked source month, expense stays put; guard proven", async () => {
    const lockedMonth = freshMonth();
    const openMonth = freshMonth();
    await lockDirectly(sourceA, lockedMonth);
    const id = await insertExpenseDirect(sourceA, itemA, lockedMonth);
    asUser();

    const result = await updateExpenseAction(validExpenseInput({ id, month: openMonth, date: `${openMonth}-06` }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(lockedMonth)));

    const row = await expenseRow(id);
    expect(row.month).toBe(lockedMonth);

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await updateExpenseAction(
      validExpenseInput({ id, month: openMonth, date: `${openMonth}-06` }),
    );
    expect(bypassed.ok).toBe(true);
  });

  it("change funding source into a locked source-month: refused, source unchanged; guard proven", async () => {
    const month = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month);
    await lockDirectly(sourceB, month);
    asUser();

    const result = await updateExpenseAction(
      validExpenseInput({ id, month, date: `${month}-06`, fundingSourceId: sourceB, lineItemId: itemB }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const row = await expenseRow(id);
    expect(row.fundingSourceId).toBe(sourceA);

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await updateExpenseAction(
      validExpenseInput({ id, month, date: `${month}-06`, fundingSourceId: sourceB, lineItemId: itemB }),
    );
    expect(bypassed.ok).toBe(true);
  });

  it("delete: refused on a locked month, not trashed; guard proven", async () => {
    const month = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month);
    await lockDirectly(sourceA, month);
    asUser();

    const result = await deleteExpenseAction(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const row = await expenseRow(id);
    expect(row.deletedAt).toBeNull();

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await deleteExpenseAction(id);
    expect(bypassed.ok).toBe(true);
  });

  it("restore: refused on a locked month, stays trashed; guard proven", async () => {
    const month = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month, { deletedAt: new Date() });
    await lockDirectly(sourceA, month);
    asUser();

    const result = await restoreExpenseAction(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const row = await expenseRow(id);
    expect(row.deletedAt).not.toBeNull();

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await restoreExpenseAction(id);
    expect(bypassed.ok).toBe(true);
  });

  it("permanently delete: refused on a locked month, row still exists; guard proven", async () => {
    const month = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month, { deletedAt: new Date() });
    await lockDirectly(sourceA, month);
    asUser();

    const result = await permanentlyDeleteExpenseAction(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const row = await expenseRow(id);
    expect(row).toBeDefined();

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await permanentlyDeleteExpenseAction(id);
    expect(bypassed.ok).toBe(true);
  });

  it("remove an expense file: refused on a locked month, file and row remain; guard proven", async () => {
    const month = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month);
    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .toBuffer();
    const attached = await ingestExpenseDocument({
      orgId,
      expenseId: id,
      scope: "proof",
      file: new File([new Uint8Array(jpeg)], "proof.jpg", { type: "image/jpeg" }),
    });
    if (!attached.ok) throw new Error(attached.error);
    await lockDirectly(sourceA, month);
    asUser();

    const result = await removeExpenseDocumentAction(attached.documentId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const [doc] = await db
      .select({ id: expenseDocuments.id, key: expenseDocuments.s3Key })
      .from(expenseDocuments)
      .where(eq(expenseDocuments.id, attached.documentId));
    expect(doc).toBeDefined();
    expect(await storage().exists(doc.key)).toBe(true);

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await removeExpenseDocumentAction(attached.documentId);
    expect(bypassed.ok).toBe(true);
  });

  it("attach an expense file: refused on a locked month, no document row created; guard proven", async () => {
    const month = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month);
    await lockDirectly(sourceA, month);

    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .toBuffer();
    const result = await ingestExpenseDocument({
      orgId,
      expenseId: id,
      scope: "proof",
      file: new File([new Uint8Array(jpeg)], "proof.jpg", { type: "image/jpeg" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const rows = await db.select().from(expenseDocuments).where(eq(expenseDocuments.expenseId, id));
    expect(rows).toHaveLength(0);

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await ingestExpenseDocument({
      orgId,
      expenseId: id,
      scope: "proof",
      file: new File([new Uint8Array(jpeg)], "proof.jpg", { type: "image/jpeg" }),
    });
    expect(bypassed.ok).toBe(true);
  });

  it("recurring 'Add to month': refused on a locked month, no expense created, reference untouched; guard proven", async () => {
    const month = freshMonth();
    const [item] = await db
      .insert(recurringItems)
      .values({ orgId, name: "Recurring guard test", amountCents: 500, lineItemId: itemA, sortOrder: 0 })
      .returning({ id: recurringItems.id });
    await lockDirectly(sourceA, month);
    asUser();

    const beforeRef = await nextRefSeqOf(sourceA, month);
    const result = await addRecurringToMonthAction(item.id, month);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const rows = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.month, month), eq(expenses.recurringItemId, item.id)));
    expect(rows).toHaveLength(0);
    expect(await nextRefSeqOf(sourceA, month)).toBe(beforeRef);

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await addRecurringToMonthAction(item.id, month);
    expect(bypassed.ok).toBe(true);
  });

  it("recurring 'Remove': refused on a locked month, expense stays; guard proven", async () => {
    const month = freshMonth();
    const [item] = await db
      .insert(recurringItems)
      .values({ orgId, name: "Recurring remove guard test", amountCents: 500, lineItemId: itemA, sortOrder: 0 })
      .returning({ id: recurringItems.id });
    asUser();
    const added = await addRecurringToMonthAction(item.id, month);
    expect(added.ok).toBe(true);

    await lockDirectly(sourceA, month);

    const result = await removeRecurringFromMonthAction(item.id, month, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const rows = await db
      .select({ deletedAt: expenses.deletedAt })
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.month, month), eq(expenses.recurringItemId, item.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeNull();

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await removeRecurringFromMonthAction(item.id, month, true);
    expect(bypassed.ok).toBe(true);
  });

  it("add month document: refused on a locked month, no row created; guard proven", async () => {
    const month = freshMonth();
    await lockDirectly(sourceA, month);

    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .toBuffer();
    const result = await ingestMonthDocument({
      orgId,
      fundingSourceId: sourceA,
      month,
      category: "bank_statement",
      file: new File([new Uint8Array(jpeg)], "statement.jpg", { type: "image/jpeg" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const rows = await db
      .select()
      .from(monthDocuments)
      .where(and(eq(monthDocuments.orgId, orgId), eq(monthDocuments.fundingSourceId, sourceA), eq(monthDocuments.month, month)));
    expect(rows).toHaveLength(0);

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await ingestMonthDocument({
      orgId,
      fundingSourceId: sourceA,
      month,
      category: "bank_statement",
      file: new File([new Uint8Array(jpeg)], "statement.jpg", { type: "image/jpeg" }),
    });
    expect(bypassed.ok).toBe(true);
  });

  it("remove month document: refused on a locked month, stays attached; guard proven", async () => {
    const month = freshMonth();
    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .toBuffer();
    const attached = await ingestMonthDocument({
      orgId,
      fundingSourceId: sourceA,
      month,
      category: "bank_statement",
      file: new File([new Uint8Array(jpeg)], "statement.jpg", { type: "image/jpeg" }),
    });
    if (!attached.ok) throw new Error(attached.error);
    await lockDirectly(sourceA, month);
    asUser();

    const result = await removeMonthDocumentAction(attached.documentId, sourceA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const [doc] = await db
      .select({ status: monthDocuments.status })
      .from(monthDocuments)
      .where(eq(monthDocuments.id, attached.documentId));
    expect(doc.status).toBe("attached");

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await removeMonthDocumentAction(attached.documentId, sourceA);
    expect(bypassed.ok).toBe(true);
  });

  it("the open-page case: a page read before the lock, saved after, is refused with nothing changed", async () => {
    const month = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month, { name: "Read before lock" });
    asUser();

    // Simulate the page load: read the expense's current values (what the edit form would hold).
    const stale = await expenseRow(id);
    expect(stale.name).toBe("Read before lock");

    // Someone else locks the month while that page is still open.
    await lockDirectly(sourceA, month);

    // The open page then saves â€” with the exact values it read, unchanged.
    const result = await updateExpenseAction(
      validExpenseInput({
        id,
        month: stale.month,
        date: stale.date,
        name: stale.name,
        subtotal: (stale.subtotalCents / 100).toFixed(2),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const after = await expenseRow(id);
    expect(after.name).toBe("Read before lock");
    expect(after.subtotalCents).toBe(stale.subtotalCents);
  });

  it("the race: a concurrent save waits on the lock's own row lock, then is refused once it commits", async () => {
    const month = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month);
    asUser();

    let releaseLock: () => void;
    const holdUntilReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let lockTaken = false;

    const lockTxPromise = db.transaction(async (tx) => {
      // The exact row lock the guard itself takes â€” proves the two really contend on the same
      // row, not just on application logic. `monthLocked` here is the mocked binding, but with
      // no queued override it runs its default implementation, the real function.
      await monthLocked(tx, orgId, [{ fundingSourceId: sourceA, month }]);
      await tx
        .update(monthStatuses)
        .set({ lockedAt: new Date() })
        .where(
          and(
            eq(monthStatuses.orgId, orgId),
            eq(monthStatuses.fundingSourceId, sourceA),
            eq(monthStatuses.month, month),
          ),
        );
      lockTaken = true;
      await holdUntilReleased; // hold the row lock open until the test says commit
    });

    // Wait until the locking transaction has actually taken the row lock.
    while (!lockTaken) await new Promise((r) => setTimeout(r, 5));

    let updateSettled = false;
    const updatePromise = updateExpenseAction(
      validExpenseInput({ id, month, date: `${month}-07`, name: "Raced edit" }),
    ).then((result) => {
      updateSettled = true;
      return result;
    });

    // Still pending while the locking transaction holds the row â€” the guard's SELECT ... FOR
    // UPDATE cannot proceed until it commits.
    await new Promise((r) => setTimeout(r, 200));
    expect(updateSettled).toBe(false);

    releaseLock!();
    await lockTxPromise;

    const result = await updatePromise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const row = await expenseRow(id);
    expect(row.name).not.toBe("Raced edit");
  }, 15_000);

  it("mark as submitted on a locked month: refused, submitted_at and the snapshot stay; guard proven", async () => {
    const month = freshMonth();
    asUser();

    const first = await markMonthSubmittedAction(month, sourceA);
    expect(first.ok).toBe(true);

    const before = await monthStatusOf(sourceA, month);
    const beforeCapturedAt = await snapshotCapturedAtOf(sourceA, month);
    expect(beforeCapturedAt).not.toBeNull();

    await lockDirectly(sourceA, month);
    await new Promise((r) => setTimeout(r, 5)); // distinguishable timestamp if the bug existed

    const result = await markMonthSubmittedAction(month, sourceA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const after = await monthStatusOf(sourceA, month);
    expect(after!.submittedAt!.getTime()).toBe(before!.submittedAt!.getTime());
    const afterCapturedAt = await snapshotCapturedAtOf(sourceA, month);
    expect(afterCapturedAt!.getTime()).toBe(beforeCapturedAt!.getTime());

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await markMonthSubmittedAction(month, sourceA);
    expect(bypassed.ok).toBe(true);
  });

  it("mark as submitted on an unlocked month still succeeds (regression)", async () => {
    const month = freshMonth();
    asUser();
    const result = await markMonthSubmittedAction(month, sourceA);
    expect(result.ok).toBe(true);
    const status = await monthStatusOf(sourceA, month);
    expect(status?.submittedAt).not.toBeNull();
  });

  it("save with noReceipt=true on a locked month: refused, receipt document row still exists; guard proven", async () => {
    const month = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month);
    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .toBuffer();
    const attached = await ingestExpenseDocument({
      orgId,
      expenseId: id,
      scope: "receipt",
      file: new File([new Uint8Array(jpeg)], "receipt.jpg", { type: "image/jpeg" }),
    });
    if (!attached.ok) throw new Error(attached.error);
    await lockDirectly(sourceA, month);
    asUser();

    const result = await updateExpenseAction(
      validExpenseInput({ id, month, date: `${month}-06`, noReceipt: true }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(month)));

    const rows = await db.select().from(expenseDocuments).where(eq(expenseDocuments.expenseId, id));
    expect(rows).toHaveLength(1);
    expect(await storage().exists(rows[0].s3Key!)).toBe(true);

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await updateExpenseAction(
      validExpenseInput({ id, month, date: `${month}-06`, noReceipt: true }),
    );
    expect(bypassed.ok).toBe(true);

    const rowsAfter = await db.select().from(expenseDocuments).where(eq(expenseDocuments.expenseId, id));
    expect(rowsAfter).toHaveLength(0);
    expect(await storage().exists(rows[0].s3Key!)).toBe(false); // regression: unlocked + noReceipt still deletes storage
  });

  it("noReceipt deletion is atomic with the update: the row is already gone by the time the old post-commit step would run", async () => {
    // Reproduces the exact race the fix closes: the old code deleted receipt rows in a
    // separate, unguarded step AFTER the guarded update transaction had already committed.
    // `carryNarrativeToTemplate` runs at precisely that point in both the old and the fixed
    // code (right after the transaction, before the old code's now-removed delete step) â€” it
    // is used here purely as a timing hook into that exact spot, not because its own behaviour
    // matters (it no-ops for a non-recurring expense).
    const month = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month);
    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .toBuffer();
    const attached = await ingestExpenseDocument({
      orgId,
      expenseId: id,
      scope: "receipt",
      file: new File([new Uint8Array(jpeg)], "receipt.jpg", { type: "image/jpeg" }),
    });
    if (!attached.ok) throw new Error(attached.error);
    asUser();

    const { carryNarrativeToTemplate: realCarry } = await vi.importActual<
      typeof import("@/src/modules/recurring/narrative")
    >("@/src/modules/recurring/narrative");

    let rowCountAtHook: number | null = null;
    narrativeSpy.mockImplementationOnce(async (input) => {
      const rows = await db.select().from(expenseDocuments).where(eq(expenseDocuments.expenseId, id));
      rowCountAtHook = rows.length;
      // A lock landing right after the update committed must not stop the receipt row from
      // already being gone â€” it was deleted atomically with the update, before this ran.
      await lockDirectly(sourceA, month);
      return realCarry(input);
    });

    const result = await updateExpenseAction(
      validExpenseInput({ id, month, date: `${month}-06`, noReceipt: true }),
    );
    expect(result.ok).toBe(true);
    expect(rowCountAtHook).toBe(0);
  });

  it("expense moved into a locked month while its upload is being inspected: attach refused, no document row created", async () => {
    const openMonth = freshMonth();
    const lockedMonth = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, openMonth);
    asUser();

    const { inspectUpload: realInspect } = await vi.importActual<
      typeof import("@/src/services/storage/inspect")
    >("@/src/services/storage/inspect");

    inspectSpy.mockImplementationOnce(async (input) => {
      // The expense moves to a locked month while the (slow) inspection is running â€” landing
      // after the stale pre-inspection read this ingestion took, before its transaction opens.
      await db.update(expenses).set({ month: lockedMonth }).where(eq(expenses.id, id));
      await lockDirectly(sourceA, lockedMonth);
      return realInspect(input);
    });

    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .toBuffer();
    const result = await ingestExpenseDocument({
      orgId,
      expenseId: id,
      scope: "proof",
      file: new File([new Uint8Array(jpeg)], "proof.jpg", { type: "image/jpeg" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(lockedMonth)));

    const rows = await db.select().from(expenseDocuments).where(eq(expenseDocuments.expenseId, id));
    expect(rows).toHaveLength(0);
  });

  it("expense moved again between the guard's row lock and the second re-read: refused as 'just changed', no document row", async () => {
    const month = freshMonth();
    const otherMonth = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month);
    asUser();

    const actualGuard = await vi.importActual<typeof import("@/src/modules/packet/month-guard")>(
      "@/src/modules/packet/month-guard",
    );
    guardSpy.mockImplementationOnce(async (tx, org, entries) => {
      const result = await actualGuard.monthLocked(tx, org, entries);
      // Simulate a second move landing in the window between the guard's own row lock and the
      // ingestion's second re-read, using the same transaction handle the guard itself runs on.
      await tx.update(expenses).set({ month: otherMonth }).where(eq(expenses.id, id));
      return result;
    });

    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .toBuffer();
    const result = await ingestExpenseDocument({
      orgId,
      expenseId: id,
      scope: "proof",
      file: new File([new Uint8Array(jpeg)], "proof.jpg", { type: "image/jpeg" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("That expense just changed. Try again.");

    const rows = await db.select().from(expenseDocuments).where(eq(expenseDocuments.expenseId, id));
    expect(rows).toHaveLength(0);
  });

  it("move OUT of a locked source-month into a different, open funding source: refused naming the locked source month, source and month unchanged; guard proven", async () => {
    const lockedMonth = freshMonth();
    const openMonth = freshMonth();
    await lockDirectly(sourceA, lockedMonth);
    const id = await insertExpenseDirect(sourceA, itemA, lockedMonth);
    asUser();

    const result = await updateExpenseAction(
      validExpenseInput({ id, month: openMonth, date: `${openMonth}-06`, fundingSourceId: sourceB, lineItemId: itemB }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(UI.monthLocked(monthLabel(lockedMonth)));

    const row = await expenseRow(id);
    expect(row.month).toBe(lockedMonth);
    expect(row.fundingSourceId).toBe(sourceA);

    guardSpy.mockResolvedValueOnce(null);
    const bypassed = await updateExpenseAction(
      validExpenseInput({ id, month: openMonth, date: `${openMonth}-06`, fundingSourceId: sourceB, lineItemId: itemB }),
    );
    expect(bypassed.ok).toBe(true);
  });

  /**
   * Fix 2 (PR #16 review): every guarded write's own WHERE now pins the (month, fundingSourceId)
   * the guard just checked, so a move that commits between the guard's row lock and the write
   * matches nothing â€” the row moved out from under it â€” rather than the write going through on
   * an id-only match. Each test below arranges that exact race with `guardSpy`: it runs the
   * REAL guard (so "not locked" is the genuine answer, not a stub), then, still inside the
   * guard's own transaction (`tx`), moves the target expense to a different month before
   * returning. Old code (id-only WHERE) let the write through anyway â€” the three explicitly
   * marked below were confirmed to fail on the pre-fix code by hand-reverting the relevant hunk.
   */
  it("update: raced by a move between the guard and the write â€” refused as 'just changed', name unchanged, no audit event (fail-before confirmed)", async () => {
    const month = freshMonth();
    const otherMonth = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month, { name: "Original" });
    asUser();

    const actualGuard = await vi.importActual<typeof import("@/src/modules/packet/month-guard")>(
      "@/src/modules/packet/month-guard",
    );
    guardSpy.mockImplementationOnce(async (tx, org, entries) => {
      const result = await actualGuard.monthLocked(tx, org, entries);
      await tx.update(expenses).set({ month: otherMonth }).where(eq(expenses.id, id));
      return result;
    });

    const result = await updateExpenseAction(
      validExpenseInput({ id, month, date: `${month}-06`, name: "Renamed" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("That expense just changed. Try again.");

    const row = await expenseRow(id);
    expect(row.name).toBe("Original");

    const events = await db.select().from(expenseAuditEvents).where(eq(expenseAuditEvents.expenseId, id));
    expect(events).toHaveLength(0);
  });

  it("delete: raced by a move between the guard and the write â€” refused as 'just changed', not trashed, no audit event (fail-before confirmed)", async () => {
    const month = freshMonth();
    const otherMonth = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month);
    asUser();

    const actualGuard = await vi.importActual<typeof import("@/src/modules/packet/month-guard")>(
      "@/src/modules/packet/month-guard",
    );
    guardSpy.mockImplementationOnce(async (tx, org, entries) => {
      const result = await actualGuard.monthLocked(tx, org, entries);
      await tx.update(expenses).set({ month: otherMonth }).where(eq(expenses.id, id));
      return result;
    });

    const result = await deleteExpenseAction(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("That expense just changed. Try again.");

    const row = await expenseRow(id);
    expect(row.deletedAt).toBeNull();

    const events = await db.select().from(expenseAuditEvents).where(eq(expenseAuditEvents.expenseId, id));
    expect(events).toHaveLength(0);
  });

  it("restore: raced by a move between the guard and the write â€” refused as 'just changed', stays trashed, no audit event", async () => {
    const month = freshMonth();
    const otherMonth = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month, { deletedAt: new Date() });
    asUser();

    const actualGuard = await vi.importActual<typeof import("@/src/modules/packet/month-guard")>(
      "@/src/modules/packet/month-guard",
    );
    guardSpy.mockImplementationOnce(async (tx, org, entries) => {
      const result = await actualGuard.monthLocked(tx, org, entries);
      await tx.update(expenses).set({ month: otherMonth }).where(eq(expenses.id, id));
      return result;
    });

    const result = await restoreExpenseAction(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("That expense just changed. Try again.");

    const row = await expenseRow(id);
    expect(row.deletedAt).not.toBeNull();

    const events = await db.select().from(expenseAuditEvents).where(eq(expenseAuditEvents.expenseId, id));
    expect(events).toHaveLength(0);
  });

  it("permanently delete: raced by a move between the guard and the write â€” refused as 'just changed', row still exists, no audit event (transaction rolled back)", async () => {
    const month = freshMonth();
    const otherMonth = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month, { deletedAt: new Date() });
    asUser();

    const actualGuard = await vi.importActual<typeof import("@/src/modules/packet/month-guard")>(
      "@/src/modules/packet/month-guard",
    );
    guardSpy.mockImplementationOnce(async (tx, org, entries) => {
      const result = await actualGuard.monthLocked(tx, org, entries);
      await tx.update(expenses).set({ month: otherMonth }).where(eq(expenses.id, id));
      return result;
    });

    const result = await permanentlyDeleteExpenseAction(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("That expense just changed. Try again.");

    const row = await expenseRow(id);
    expect(row).toBeDefined();

    // The audit event was inserted before the WHERE found nothing, inside the same transaction
    // that then threw and rolled back â€” it must not survive that rollback.
    const events = await db.select().from(expenseAuditEvents).where(eq(expenseAuditEvents.expenseId, id));
    expect(events).toHaveLength(0);
  });

  it("remove an expense file: raced by a move between the guard and the re-read â€” refused as 'just changed', file and row remain", async () => {
    const month = freshMonth();
    const otherMonth = freshMonth();
    const id = await insertExpenseDirect(sourceA, itemA, month);
    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .toBuffer();
    const attached = await ingestExpenseDocument({
      orgId,
      expenseId: id,
      scope: "proof",
      file: new File([new Uint8Array(jpeg)], "proof.jpg", { type: "image/jpeg" }),
    });
    if (!attached.ok) throw new Error(attached.error);
    asUser();

    const actualGuard = await vi.importActual<typeof import("@/src/modules/packet/month-guard")>(
      "@/src/modules/packet/month-guard",
    );
    guardSpy.mockImplementationOnce(async (tx, org, entries) => {
      const result = await actualGuard.monthLocked(tx, org, entries);
      await tx.update(expenses).set({ month: otherMonth }).where(eq(expenses.id, id));
      return result;
    });

    const result = await removeExpenseDocumentAction(attached.documentId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("That expense just changed. Try again.");

    const [doc] = await db
      .select({ id: expenseDocuments.id, key: expenseDocuments.s3Key })
      .from(expenseDocuments)
      .where(eq(expenseDocuments.id, attached.documentId));
    expect(doc).toBeDefined();
    expect(await storage().exists(doc.key)).toBe(true);
  });

  it("recurring 'Remove': raced by a move between the guard and the write â€” refused as 'just changed', expense stays (fail-before confirmed: old code returned ok on zero rows updated)", async () => {
    const month = freshMonth();
    const otherMonth = freshMonth();
    const [item] = await db
      .insert(recurringItems)
      .values({ orgId, name: "Recurring race test", amountCents: 500, lineItemId: itemA, sortOrder: 0 })
      .returning({ id: recurringItems.id });
    asUser();
    const added = await addRecurringToMonthAction(item.id, month);
    expect(added.ok).toBe(true);

    const [createdRow] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.month, month), eq(expenses.recurringItemId, item.id)));

    const actualGuard = await vi.importActual<typeof import("@/src/modules/packet/month-guard")>(
      "@/src/modules/packet/month-guard",
    );
    guardSpy.mockImplementationOnce(async (tx, org, entries) => {
      const result = await actualGuard.monthLocked(tx, org, entries);
      await tx.update(expenses).set({ month: otherMonth }).where(eq(expenses.id, createdRow.id));
      return result;
    });

    const result = await removeRecurringFromMonthAction(item.id, month, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("That expense just changed. Try again.");

    const row = await expenseRow(createdRow.id);
    expect(row.deletedAt).toBeNull();
  });

  /*
   * The guard only holds if it runs on the write's own transaction (month-guard.ts). Called on
   * the pooled `db` instead, its row lock is released the moment its own statement commits, so
   * a lock can land between the check and the write — and every refusal test above still
   * passes, because a lock that is already committed is seen either way. So each write is run
   * once on an open month and the executor the guard received is checked directly.
   */
  const jpegFile = async (name: string) =>
    new File(
      [
        new Uint8Array(
          await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
            .jpeg()
            .toBuffer(),
        ),
      ],
      name,
      { type: "image/jpeg" },
    );

  const guardedWrites: { name: string; run: () => Promise<{ ok: boolean }> }[] = [
    {
      name: "create expense",
      run: () => {
        const month = freshMonth();
        return createExpenseAction(validExpenseInput({ month, date: `${month}-06` }));
      },
    },
    {
      name: "edit and move an expense",
      run: async () => {
        const id = await insertExpenseDirect(sourceA, itemA, freshMonth());
        const target = freshMonth();
        return updateExpenseAction(validExpenseInput({ id, month: target, date: `${target}-06` }));
      },
    },
    {
      name: "delete an expense",
      run: async () => deleteExpenseAction(await insertExpenseDirect(sourceA, itemA, freshMonth())),
    },
    {
      name: "restore an expense",
      run: async () =>
        restoreExpenseAction(await insertExpenseDirect(sourceA, itemA, freshMonth(), { deletedAt: new Date() })),
    },
    {
      name: "permanently delete an expense",
      run: async () =>
        permanentlyDeleteExpenseAction(
          await insertExpenseDirect(sourceA, itemA, freshMonth(), { deletedAt: new Date() }),
        ),
    },
    {
      name: "attach an expense file",
      run: async () =>
        ingestExpenseDocument({
          orgId,
          expenseId: await insertExpenseDirect(sourceA, itemA, freshMonth()),
          scope: "proof",
          file: await jpegFile("proof.jpg"),
        }),
    },
    {
      name: "remove an expense file",
      run: async () => {
        const attached = await ingestExpenseDocument({
          orgId,
          expenseId: await insertExpenseDirect(sourceA, itemA, freshMonth()),
          scope: "proof",
          file: await jpegFile("proof.jpg"),
        });
        if (!attached.ok) throw new Error(attached.error);
        guardSpy.mockClear();
        return removeExpenseDocumentAction(attached.documentId);
      },
    },
    {
      name: "recurring 'Add to month'",
      run: async () => {
        const [item] = await db
          .insert(recurringItems)
          .values({ orgId, name: "Executor add", amountCents: 500, lineItemId: itemA, sortOrder: 0 })
          .returning({ id: recurringItems.id });
        return addRecurringToMonthAction(item.id, freshMonth());
      },
    },
    {
      name: "recurring 'Remove'",
      run: async () => {
        const month = freshMonth();
        const [item] = await db
          .insert(recurringItems)
          .values({ orgId, name: "Executor remove", amountCents: 500, lineItemId: itemA, sortOrder: 0 })
          .returning({ id: recurringItems.id });
        const added = await addRecurringToMonthAction(item.id, month);
        if (!added.ok) throw new Error(added.error);
        guardSpy.mockClear();
        return removeRecurringFromMonthAction(item.id, month, true);
      },
    },
    {
      name: "add a month document",
      run: async () =>
        ingestMonthDocument({
          orgId,
          fundingSourceId: sourceA,
          month: freshMonth(),
          category: "bank_statement",
          file: await jpegFile("statement.jpg"),
        }),
    },
    {
      name: "remove a month document",
      run: async () => {
        const attached = await ingestMonthDocument({
          orgId,
          fundingSourceId: sourceA,
          month: freshMonth(),
          category: "bank_statement",
          file: await jpegFile("statement.jpg"),
        });
        if (!attached.ok) throw new Error(attached.error);
        guardSpy.mockClear();
        return removeMonthDocumentAction(attached.documentId, sourceA);
      },
    },
    {
      name: "mark as submitted",
      run: () => markMonthSubmittedAction(freshMonth(), sourceA),
    },
    {
      name: "lock a month",
      run: async () => {
        const { lockMonth } = await import("./lock");
        const { PDFDocument } = await import("pdf-lib");
        const pdf = await PDFDocument.create();
        pdf.addPage([612, 792]);
        const file = new File([new Uint8Array(await pdf.save())], "signed.pdf", { type: "application/pdf" });
        return lockMonth({ orgId, userId, fundingSourceId: sourceA, month: freshMonth(), file });
      },
    },
  ];

  it.each(guardedWrites)("$name: the guard runs on the write's own transaction, never the pooled db", async ({ run }) => {
    asUser();
    guardSpy.mockClear();

    const result = await run();
    expect(result.ok).toBe(true);

    const executors = guardSpy.mock.calls.map(([executor]) => executor);
    expect(executors.length).toBeGreaterThan(0);
    for (const executor of executors) expect(executor).not.toBe(db);
  });
});
