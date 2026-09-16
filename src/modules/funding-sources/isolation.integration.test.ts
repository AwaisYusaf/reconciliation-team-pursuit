/**
 * P7.1 â€” the acceptance criterion "Adding or editing a second source changes nothing in the
 * first" (docs/PHASE-6.md Â§5 Phase 7, Â§6, Appendix A).
 *
 * Source A is fully populated through the real actions where one exists (line items, a
 * performance, expenses with attached documents, a month document, a submission). Every
 * figure and row Phase 6 scoped by funding source is captured. Source B is then created and
 * put through its own full lifecycle â€” created, given a same-named line item, expenses in the
 * same month, a month document, submitted, edited, archived and unarchived, with one of its
 * expenses moved to another month. Source A is re-read afterward and must be byte-for-byte the
 * same as before, including its reference counter and its month snapshot's cache hash.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("adding or editing a second source changes nothing in the first (P7.1)", async () => {
  const { db } = await import("@/src/db");
  const {
    expenseDocuments,
    expenses,
    fundingSources,
    monthDocuments,
    monthSnapshotTotals,
    monthSnapshots,
    monthStatuses,
    organizations,
    paymentSources,
    users,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { loadExpenseAmounts, loadFundingSourceSettings, loadLineItemBudgets } = await import(
    "@/src/db/queries"
  );
  const { inputsHash } = await import("@/src/generation/cache-key");
  const { loadMonthSnapshot } = await import("@/src/generation/month-snapshot");
  const { actionSession } = await import("@/src/lib/action-session");
  const { addLineItemPerformanceAction } = await import("@/src/modules/line-items/actions");
  const { loadLineItemRows } = await import("@/src/modules/line-items/queries");
  const { createExpenseAction, updateExpenseAction } = await import("@/src/modules/expenses/actions");
  const {
    archiveFundingSourceAction,
    createFundingSourceAction,
    unarchiveFundingSourceAction,
    updateFundingSourceAction,
  } = await import("./actions");
  const { saveLineItemAction } = await import("@/src/modules/line-items/actions");
  const { markMonthSubmittedAction } = await import("@/src/modules/packet/actions");
  const { loadPacketReadiness } = await import("@/src/modules/packet/queries");

  const session = vi.mocked(actionSession);
  const GENERATOR_VERSION = "packet-12"; // app/api/downloads/packet/route.ts

  const MONTH = "2097-05";
  const OTHER_MONTH = "2097-06";

  let orgId: string;
  let sourceA: string;
  let sourceB: string;
  let itemSalaryA: string;
  let itemTravelA: string;
  let userId: string;

  function asOrg() {
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

  function expenseInput(overrides: Partial<Parameters<typeof createExpenseAction>[0]>) {
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
      narrative: "A narrative, so the gate is satisfied.",
      noReceipt: true,
      noReceiptReason: "Cash payment, no receipt issued.",
      ...overrides,
    };
  }

  /** Opens the documentation gate without touching storage â€” a real action doesn't exist
   *  for attaching a proven document, only for the upload pipeline (sharp/inspectUpload),
   *  which this test does not need to exercise. */
  async function attachProof(expenseId: string) {
    await db.insert(expenseDocuments).values({
      orgId,
      expenseId,
      kind: "proof",
      status: "attached",
      s3Key: `test/${expenseId}/proof.jpg`,
      filename: "proof.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 100,
      sortOrder: 0,
    });
  }

  /** Same reasoning as `attachProof`: no server action inserts a month document row directly. */
  async function attachMonthDocument(fundingSourceId: string, month: string, title: string) {
    await db.insert(monthDocuments).values({
      orgId,
      fundingSourceId,
      month,
      category: "bank_statement",
      title,
      status: "attached",
      s3Key: `test/${fundingSourceId}/${month}/statement.pdf`,
      filename: "statement.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sortOrder: 0,
    });
  }

  async function createFullExpense(
    fundingSourceId: string,
    lineItemId: string,
    name: string,
    month = MONTH,
  ) {
    const result = await createExpenseAction(
      expenseInput({ fundingSourceId, lineItemId, name, month, date: `${month}-05` }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    await attachProof(result.data.id);
    return result.data.id;
  }

  // ---- capture of source A's state, read fresh from the database/query layer each time ----
  async function captureA() {
    const budgets = await loadLineItemBudgets(orgId, sourceA);
    const amounts = await loadExpenseAmounts(orgId, sourceA, MONTH);
    const settings = await loadFundingSourceSettings(orgId, sourceA);
    const readiness = await loadPacketReadiness(orgId, sourceA, MONTH);
    const [monthStatus] = await db
      .select({ nextReferenceSeq: monthStatuses.nextReferenceSeq, submittedAt: monthStatuses.submittedAt })
      .from(monthStatuses)
      .where(
        and(
          eq(monthStatuses.orgId, orgId),
          eq(monthStatuses.fundingSourceId, sourceA),
          eq(monthStatuses.month, MONTH),
        ),
      );
    const snapshotRows = await db
      .select({
        lineItemName: monthSnapshots.lineItemName,
        scheduledValueCents: monthSnapshots.scheduledValueCents,
        previouslyBilledCents: monthSnapshots.previouslyBilledCents,
        spentThisMonthCents: monthSnapshots.spentThisMonthCents,
        totalBilledCents: monthSnapshots.totalBilledCents,
        remainingCents: monthSnapshots.remainingCents,
      })
      .from(monthSnapshots)
      .where(
        and(
          eq(monthSnapshots.orgId, orgId),
          eq(monthSnapshots.fundingSourceId, sourceA),
          eq(monthSnapshots.month, MONTH),
        ),
      )
      .orderBy(asc(monthSnapshots.lineItemName));
    const [totals] = await db
      .select({
        contractValueCents: monthSnapshotTotals.contractValueCents,
        perfGrantScheduledCents: monthSnapshotTotals.perfGrantScheduledCents,
        perfGrantBilledCents: monthSnapshotTotals.perfGrantBilledCents,
        advancesReceivedCents: monthSnapshotTotals.advancesReceivedCents,
      })
      .from(monthSnapshotTotals)
      .where(
        and(
          eq(monthSnapshotTotals.orgId, orgId),
          eq(monthSnapshotTotals.fundingSourceId, sourceA),
          eq(monthSnapshotTotals.month, MONTH),
        ),
      );
    const snapshot = await loadMonthSnapshot(orgId, sourceA, MONTH);
    const hash = inputsHash({ snapshot, generatorVersion: GENERATOR_VERSION });

    return { budgets, amounts, settings, readiness, monthStatus, snapshotRows, totals, snapshot, hash };
  }

  let before: Awaited<ReturnType<typeof captureA>>;

  beforeAll(async () => {
    const org = await createTestOrg({ name: "P7.1 Isolation Org", activeMonth: MONTH });
    orgId = org.orgId;
    sourceA = org.fundingSourceId;
    await db.insert(paymentSources).values({ orgId, label: "Cash", sortOrder: 0 });
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `p71-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    userId = user.id;

    asOrg();

    const salary = await saveLineItemAction({
      fundingSourceId: sourceA,
      name: "Salary",
      scheduledValue: "10000.00",
      openingBilled: "0.00",
    });
    expect(salary.ok).toBe(true);
    const travel = await saveLineItemAction({
      fundingSourceId: sourceA,
      name: "Travel",
      scheduledValue: "5000.00",
      openingBilled: "0.00",
    });
    expect(travel.ok).toBe(true);

    const rowsA = await loadLineItemRows(orgId, sourceA);
    itemSalaryA = rowsA.find((r) => r.name === "Salary")!.id;
    itemTravelA = rowsA.find((r) => r.name === "Travel")!.id;

    const perf = await addLineItemPerformanceAction({
      lineItemId: itemSalaryA,
      name: "Q1 outcomes bonus",
      amount: "1500.00",
      date: `${MONTH}-01`,
    });
    expect(perf.ok).toBe(true);

    await createFullExpense(sourceA, itemSalaryA, "A salary expense 1");
    await createFullExpense(sourceA, itemSalaryA, "A salary expense 2");
    await createFullExpense(sourceA, itemTravelA, "A travel expense 1");

    await attachMonthDocument(sourceA, MONTH, "A's bank statement");

    const submitted = await markMonthSubmittedAction(MONTH, sourceA);
    expect(submitted.ok).toBe(true);

    before = await captureA();
    // Sanity: the fixture actually produced data worth comparing, not empty defaults.
    expect(before.budgets.length).toBe(2);
    expect(before.amounts.length).toBe(3);
    expect(before.readiness.blocking).toEqual([]);
    expect(before.monthStatus.nextReferenceSeq).toBe(4); // 3 expenses claimed 1, 2, 3
    expect(before.monthStatus.submittedAt).not.toBeNull();
    expect(before.snapshotRows.length).toBe(2);
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("creating, populating, editing, archiving and unarchiving a second source leaves source A byte-for-byte unchanged", async () => {
    asOrg();

    const created = await createFundingSourceAction({
      name: "Foundation Grant B",
      type: "donation",
      docName: "",
      projectName: "",
      contractNumber: "",
      basePoNumber: "",
      performancePoNumber: "",
      contractValue: "5000.00",
      contractStart: "",
      contractEnd: "",
      fiduciaryName: "",
      advancesReceived: "0.00",
      taxReimbursable: true,
      feesReimbursable: false,
    });
    expect(created.ok).toBe(true);

    const [bRow] = await db
      .select({ id: fundingSources.id })
      .from(fundingSources)
      .where(and(eq(fundingSources.orgId, orgId), eq(fundingSources.name, "Foundation Grant B")));
    sourceB = bRow.id;

    // Same name as one of A's line items â€” allowed, because uniqueness is scoped per source.
    const bSalary = await saveLineItemAction({
      fundingSourceId: sourceB,
      name: "Salary",
      scheduledValue: "2000.00",
      openingBilled: "0.00",
    });
    expect(bSalary.ok).toBe(true);
    const rowsB = await loadLineItemRows(orgId, sourceB);
    const itemSalaryB = rowsB.find((r) => r.name === "Salary")!.id;

    const bExpenseId = await createFullExpense(sourceB, itemSalaryB, "B salary expense 1", MONTH);
    const [bExpenseRow] = await db
      .select({ referenceSeq: expenses.referenceSeq })
      .from(expenses)
      .where(eq(expenses.id, bExpenseId));
    // B's reference numbering starts at 1, independent of A's counter.
    expect(bExpenseRow.referenceSeq).toBe(1);

    await attachMonthDocument(sourceB, MONTH, "B's bank statement");

    const bSubmitted = await markMonthSubmittedAction(MONTH, sourceB);
    expect(bSubmitted.ok).toBe(true);

    const edited = await updateFundingSourceAction({
      id: sourceB,
      name: "Foundation Grant B (renamed)",
      type: "donation",
      docName: "",
      projectName: "",
      contractNumber: "",
      basePoNumber: "",
      performancePoNumber: "",
      contractValue: "9000.00",
      contractStart: "",
      contractEnd: "",
      fiduciaryName: "",
      advancesReceived: "500.00",
      taxReimbursable: false,
      feesReimbursable: true,
    });
    expect(edited.ok).toBe(true);

    const archived = await archiveFundingSourceAction(sourceB);
    expect(archived.ok).toBe(true);
    const unarchived = await unarchiveFundingSourceAction(sourceB);
    expect(unarchived.ok).toBe(true);

    const moved = await updateExpenseAction(
      expenseInput({
        id: bExpenseId,
        fundingSourceId: sourceB,
        lineItemId: itemSalaryB,
        name: "B salary expense 1",
        month: OTHER_MONTH,
        date: `${OTHER_MONTH}-05`,
      }),
    );
    expect(moved.ok).toBe(true);

    // ---- re-capture A ----
    const after = await captureA();

    expect(after.budgets).toEqual(before.budgets);
    expect(after.amounts).toEqual(before.amounts);
    expect(after.settings).toEqual(before.settings);
    expect(after.readiness).toEqual(before.readiness);
    expect(after.monthStatus).toEqual(before.monthStatus);
    expect(after.snapshotRows).toEqual(before.snapshotRows);
    expect(after.totals).toEqual(before.totals);
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.hash).toBe(before.hash);

    // A's reference counter is unchanged, even though B claimed its own numbers throughout.
    expect(after.monthStatus.nextReferenceSeq).toBe(before.monthStatus.nextReferenceSeq);

    // Neither source's snapshot contains a trace of the other.
    const snapshotA = after.snapshot;
    const snapshotB = await loadMonthSnapshot(orgId, sourceB, OTHER_MONTH);
    const aExpenseIds = new Set(snapshotA.expenses.map((e) => e.id));
    const aLineItemIds = new Set(snapshotA.lineItems.map((i) => i.id));
    const aMonthDocIds = new Set(snapshotA.monthDocuments.map((d) => d.id));
    for (const expense of snapshotB.expenses) expect(aExpenseIds.has(expense.id)).toBe(false);
    for (const item of snapshotB.lineItems) expect(aLineItemIds.has(item.id)).toBe(false);
    for (const doc of snapshotB.monthDocuments) expect(aMonthDocIds.has(doc.id)).toBe(false);

    const bExpenseIds = new Set(snapshotB.expenses.map((e) => e.id));
    const bLineItemIds = new Set(snapshotB.lineItems.map((i) => i.id));
    const bMonthDocIds = new Set(snapshotB.monthDocuments.map((d) => d.id));
    for (const expense of snapshotA.expenses) expect(bExpenseIds.has(expense.id)).toBe(false);
    for (const item of snapshotA.lineItems) expect(bLineItemIds.has(item.id)).toBe(false);
    for (const doc of snapshotA.monthDocuments) expect(bMonthDocIds.has(doc.id)).toBe(false);
  });
});
