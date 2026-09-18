/**
 * Unit tests for `factsFingerprint` (Phase 11, D-107, P7; PR #18 round 2, #7). PHASE-11.md §10
 * U-12, U-13. The notice must fire for anything the summary's figures come from — not only this
 * month's expenses — and must not fire for a reorder that changes no figure.
 */
import { describe, expect, it } from "vitest";

import type { ExpenseAmount, LineItemBudget } from "@/src/domain/budget-math";
import { buildMonthFacts, type SummaryExpense } from "@/src/domain/monthly-summary-facts";

import { factsFingerprint } from "./fingerprint";

const salary: LineItemBudget = {
  id: "li-1",
  name: "Salary",
  scheduledValueCents: 100_000,
  performanceCents: 0,
  newPerformanceCents: 0,
  openingBilledCents: 0,
  sortOrder: 0,
};

function spent(month: string, subtotalCents: number): ExpenseAmount {
  return { lineItemId: "li-1", month, subtotalCents, taxCents: 0, feesCents: 0, taxReimbursable: false, feesReimbursable: false };
}

function expense(id: string, name: string, subtotalCents: number): SummaryExpense {
  return {
    id,
    lineItemId: "li-1",
    name,
    description: "desc",
    narrative: null,
    note: null,
    date: "2097-03-01",
    subtotalCents,
    taxCents: 0,
    feesCents: 0,
    taxReimbursable: false,
    feesReimbursable: false,
    noReceipt: false,
    noReceiptReason: null,
  };
}

function fingerprint(overrides: {
  lineItems?: LineItemBudget[];
  expensesUpToMonth?: ExpenseAmount[];
  monthExpenses?: SummaryExpense[];
} = {}): string {
  const monthExpenses = overrides.monthExpenses ?? [expense("a", "Payroll 1", 5_000), expense("b", "Payroll 2", 7_000)];
  return factsFingerprint(
    buildMonthFacts({
      orgDocName: "Team Pursuit",
      source: { name: "City of Detroit", docName: null },
      month: "2097-03",
      lineItems: overrides.lineItems ?? [salary],
      expensesUpToMonth: overrides.expensesUpToMonth ?? [spent("2097-02", 20_000), spent("2097-03", 12_000)],
      monthExpenses,
      settings: { contractValueCents: 0, advancesReceivedCents: 0 },
    }),
  );
}

describe("factsFingerprint", () => {
  it("is a 64-character hex sha256, stable for the same records", () => {
    expect(fingerprint()).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint()).toBe(fingerprint());
  });

  it("changes when this month's expenses change", () => {
    expect(fingerprint({ monthExpenses: [expense("a", "Payroll 1", 5_000)] })).not.toBe(fingerprint());
    expect(
      fingerprint({ monthExpenses: [expense("a", "Payroll 1", 5_000), expense("b", "Payroll 2 (fixed)", 7_000)] }),
    ).not.toBe(fingerprint());
  });

  it("changes when a budget changes, with no expense touched (round 2, #7)", () => {
    expect(fingerprint({ lineItems: [{ ...salary, scheduledValueCents: 150_000 }] })).not.toBe(fingerprint());
  });

  it("changes when an earlier month's expense changes, with this month untouched (round 2, #7)", () => {
    expect(fingerprint({ expensesUpToMonth: [spent("2097-02", 25_000), spent("2097-03", 12_000)] })).not.toBe(
      fingerprint(),
    );
  });

  it("does not change when expenses are only reordered", () => {
    const reordered = fingerprint({ monthExpenses: [expense("b", "Payroll 2", 7_000), expense("a", "Payroll 1", 5_000)] });
    expect(reordered).toBe(fingerprint());
  });
});

describe("factsFingerprint: Items to note are order-free too (PR #18 round 3, #4)", () => {
  const noReceipt = (id: string, name: string): SummaryExpense => ({
    ...expense(id, name, 3_000),
    noReceipt: true,
    noReceiptReason: `${name} reason`,
  });
  const refund = (id: string, name: string): SummaryExpense => expense(id, name, -2_000);
  // Tax not reimbursed puts the expense under Not reimbursed.
  const taxed = (id: string, name: string): SummaryExpense => ({ ...expense(id, name, 4_000), taxCents: 300 });

  it("reordering the expenses behind No receipt, Refunds and Not reimbursed doesn't read as a change", () => {
    const first = fingerprint({
      monthExpenses: [noReceipt("a", "Taxi"), noReceipt("b", "Parking"), refund("c", "Return"), refund("d", "Credit"), taxed("e", "Laptop"), taxed("f", "Printer")],
    });
    const reordered = fingerprint({
      monthExpenses: [taxed("f", "Printer"), refund("d", "Credit"), noReceipt("b", "Parking"), taxed("e", "Laptop"), refund("c", "Return"), noReceipt("a", "Taxi")],
    });
    expect(reordered).toBe(first);
  });
});
