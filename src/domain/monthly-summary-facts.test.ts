/**
 * Unit tests for `buildMonthFacts` / `serializeFactsForPrompt` (Phase 11, D-107).
 * Covers PHASE-11.md §10 U-1..U-13, U-17, U-20, and the P16 cut boundary.
 */
import { describe, expect, it } from "vitest";

import { allLineItemStats, grantPosition, type ExpenseAmount, type LineItemBudget } from "./budget-math";
import { contractSummary } from "./summary";
import {
  SUMMARY_FACTS_MAX_CHARS,
  SUMMARY_FIELD_MAX_CHARS,
  buildMonthFacts,
  serializeFactsForPrompt,
  type SummaryExpense,
} from "./monthly-summary-facts";

const ORG_DOC_NAME = "Team Pursuit";
const SOURCE = { name: "City of Detroit", docName: null as string | null };
const NO_SETTINGS = { contractValueCents: 0, advancesReceivedCents: 0 };

function lineItem(overrides: Partial<LineItemBudget> & { id: string; name: string }): LineItemBudget {
  return {
    scheduledValueCents: 0,
    performanceCents: 0,
    newPerformanceCents: 0,
    openingBilledCents: 0,
    sortOrder: 0,
    ...overrides,
  };
}

function expenseAmount(overrides: Partial<ExpenseAmount> & { lineItemId: string; month: string }): ExpenseAmount {
  return {
    subtotalCents: 0,
    taxCents: 0,
    feesCents: 0,
    taxReimbursable: false,
    feesReimbursable: false,
    ...overrides,
  };
}

function summaryExpense(
  overrides: Partial<SummaryExpense> & { id: string; lineItemId: string; name: string },
): SummaryExpense {
  return {
    description: "",
    narrative: null,
    note: null,
    date: "2097-03-01",
    subtotalCents: 0,
    taxCents: 0,
    feesCents: 0,
    taxReimbursable: false,
    feesReimbursable: false,
    noReceipt: false,
    noReceiptReason: null,
    ...overrides,
  };
}

describe("buildMonthFacts — U-20 month key validation", () => {
  it("throws on an invalid month key", () => {
    expect(() =>
      buildMonthFacts({
        orgDocName: ORG_DOC_NAME,
        source: SOURCE,
        month: "2097-13",
        lineItems: [],
        expensesUpToMonth: [],
        monthExpenses: [],
        settings: NO_SETTINGS,
      }),
    ).toThrow(/Invalid month key/);
  });

  it("throws on a non-month-shaped string", () => {
    expect(() =>
      buildMonthFacts({
        orgDocName: ORG_DOC_NAME,
        source: SOURCE,
        month: "not-a-month",
        lineItems: [],
        expensesUpToMonth: [],
        monthExpenses: [],
        settings: NO_SETTINGS,
      }),
    ).toThrow(/Invalid month key/);
  });
});

describe("buildMonthFacts — U-1 per-line-item figures equal lineItemStats", () => {
  it("every budget.lineItems row matches allLineItemStats for the same inputs", () => {
    const items: LineItemBudget[] = [
      lineItem({ id: "a", name: "Salary", scheduledValueCents: 500_000, openingBilledCents: 10_000, sortOrder: 0 }),
      lineItem({ id: "b", name: "Travel", scheduledValueCents: 200_000, sortOrder: 1 }),
    ];
    const expenses: ExpenseAmount[] = [
      expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: 40_000 }),
      expenseAmount({ lineItemId: "b", month: "2097-03", subtotalCents: 15_000 }),
      expenseAmount({ lineItemId: "b", month: "2097-02", subtotalCents: 5_000 }),
    ];
    const monthExpenses: SummaryExpense[] = [
      summaryExpense({ id: "e1", lineItemId: "a", name: "Payroll", subtotalCents: 40_000, date: "2097-03-05" }),
      summaryExpense({ id: "e2", lineItemId: "b", name: "Flight", subtotalCents: 15_000, date: "2097-03-06" }),
    ];

    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth: expenses,
      monthExpenses,
      settings: NO_SETTINGS,
    });

    const stats = allLineItemStats(items, expenses, "2097-03");
    for (const stat of stats) {
      const row = facts.budget.lineItems.find((r) => r.name === stat.lineItem.name)!;
      expect(row.scheduled.cents).toBe(stat.lineItem.scheduledValueCents);
      expect(row.spentThisMonth.cents).toBe(stat.spentThisMonthCents);
      expect(row.spentToDate.cents).toBe(stat.totalBilledCents);
      expect(row.remaining.cents).toBe(stat.remainingCents);
    }
  });
});

describe("buildMonthFacts — U-2 overall figures", () => {
  it("without a configured contract value: contractTotal falls back to total scheduled", () => {
    const items: LineItemBudget[] = [
      lineItem({ id: "a", name: "Salary", scheduledValueCents: 500_000, sortOrder: 0 }),
      lineItem({ id: "b", name: "Travel", scheduledValueCents: 200_000, sortOrder: 1 }),
    ];
    const expenses: ExpenseAmount[] = [expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: 10_000 })];

    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth: expenses,
      monthExpenses: [],
      settings: { contractValueCents: 0, advancesReceivedCents: 0 },
    });

    const stats = allLineItemStats(items, expenses, "2097-03");
    const grant = grantPosition(stats);
    const summary = contractSummary({ lineItems: items, expenses, settings: NO_SETTINGS, month: "2097-03" });

    expect(facts.budget.overall.approved.cents).toBe(grant.approvedCents);
    expect(facts.budget.overall.spentToDate.cents).toBe(grant.spentToDateCents);
    expect(facts.budget.overall.remaining.cents).toBe(grant.remainingCents);
    expect(facts.budget.overall.contractTotal.cents).toBe(summary.contractTotalCents);
    expect(facts.budget.overall.contractTotal.cents).toBe(700_000); // no contract value → sum of scheduled
  });

  it("with a configured contract value and an uncounted (migrated) performance: contractTotal is the setting alone", () => {
    const items: LineItemBudget[] = [
      lineItem({
        id: "a",
        name: "Salary",
        scheduledValueCents: 500_000,
        performanceCents: 50_000,
        newPerformanceCents: 0, // migrated performance — does not count toward contract total (D-82)
        sortOrder: 0,
      }),
    ];
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth: [],
      monthExpenses: [],
      settings: { contractValueCents: 300_000, advancesReceivedCents: 0 },
    });
    const summary = contractSummary({
      lineItems: items,
      expenses: [],
      settings: { contractValueCents: 300_000, advancesReceivedCents: 0 },
      month: "2097-03",
    });
    expect(facts.budget.overall.contractTotal.cents).toBe(summary.contractTotalCents);
    expect(facts.budget.overall.contractTotal.cents).toBe(300_000);
  });

  it("with a configured contract value and a counted (new) performance: contractTotal adds the new performance on top", () => {
    const items: LineItemBudget[] = [
      lineItem({
        id: "a",
        name: "Salary",
        scheduledValueCents: 550_000,
        performanceCents: 50_000,
        newPerformanceCents: 50_000, // counted toward the contract total (D-82)
        sortOrder: 0,
      }),
    ];
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth: [],
      monthExpenses: [],
      settings: { contractValueCents: 300_000, advancesReceivedCents: 0 },
    });
    const summary = contractSummary({
      lineItems: items,
      expenses: [],
      settings: { contractValueCents: 300_000, advancesReceivedCents: 0 },
      month: "2097-03",
    });
    expect(facts.budget.overall.contractTotal.cents).toBe(summary.contractTotalCents);
    expect(facts.budget.overall.contractTotal.cents).toBe(350_000);
  });
});

describe("buildMonthFacts — U-3 hand-built month", () => {
  // Hand-computed fixture (verified with pen-and-paper arithmetic, not by calling the code
  // under test or budget-math). See the review notes for the full derivation:
  //
  // Line item A "Salary": scheduled $2,000.00, opening billed $500.00.
  //   Feb expense (prior month): subtotal $80.00, nothing excluded → reimbursable $80.00.
  //   March expense #1: subtotal $150.00, tax $15.00 excluded, fees $5.00 reimbursed
  //     → reimbursable = 150+5 = $155.00; receipt total = 150+15+5 = $170.00.
  //   March expense #2 (refund): subtotal -$30.00 → reimbursable -$30.00.
  //   A earlierCents = $80.00; A spentThisMonth = 155.00 - 30.00 = $125.00.
  //   A previouslyBilled = 500.00 + 80.00 = $580.00; A totalBilled = 580 + 125 = $705.00.
  //   A remaining = 2000.00 - 705.00 = $1,295.00; percent = 705/2000 = 35.25% → rounds to 35%.
  //
  // Line item B "Travel": scheduled $1,000.00 base + $200.00 performance = $1,200.00, opening $0.
  //   March expense (no receipt): subtotal $60.00 → reimbursable $60.00.
  //   B spentThisMonth = $60.00; B totalBilled = $60.00; B remaining = $1,140.00; percent = 5%.
  //
  // Overall: approved = 2000+1200 = $3,200.00; spentToDate = 705+60 = $765.00;
  //   remaining = 3200-765 = $2,435.00; percent = 765/3200 = 23.90625% → rounds to 24%.
  //   No contract value configured → contractTotal = sum of scheduled = $3,200.00.
  //
  // Changes vs Feb: A previous $80.00 → current $125.00, diff $45.00 up, 45/80 = 56.25% → 56%;
  //   diff $45.00 < $100.00 noticeable floor → NOT noticeable.
  //   B previous $0.00 (nothing in Feb) → current $60.00: "from nothing" → noticeable = true,
  //   changePercent = null (previous is zero).
  it("matches every hand-computed figure and string", () => {
    const items: LineItemBudget[] = [
      lineItem({ id: "a", name: "Salary", scheduledValueCents: 200_000, openingBilledCents: 50_000, sortOrder: 0 }),
      lineItem({
        id: "b",
        name: "Travel",
        scheduledValueCents: 120_000,
        performanceCents: 20_000,
        newPerformanceCents: 20_000,
        sortOrder: 1,
      }),
    ];

    const expensesUpToMonth: ExpenseAmount[] = [
      expenseAmount({ lineItemId: "a", month: "2097-02", subtotalCents: 8_000 }),
      expenseAmount({
        lineItemId: "a",
        month: "2097-03",
        subtotalCents: 15_000,
        taxCents: 1_500,
        feesCents: 500,
        taxReimbursable: false,
        feesReimbursable: true,
      }),
      expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: -3_000 }),
      expenseAmount({ lineItemId: "b", month: "2097-03", subtotalCents: 6_000 }),
    ];

    const monthExpenses: SummaryExpense[] = [
      summaryExpense({
        id: "e2",
        lineItemId: "a",
        name: "Consultant Fee",
        description: "Salary consulting",
        narrative: "Ongoing salary support",
        note: null,
        date: "2097-03-10",
        subtotalCents: 15_000,
        taxCents: 1_500,
        feesCents: 500,
        taxReimbursable: false,
        feesReimbursable: true,
      }),
      summaryExpense({
        id: "e3",
        lineItemId: "a",
        name: "Consultant Refund",
        description: "Refund of overpayment",
        date: "2097-03-12",
        subtotalCents: -3_000,
      }),
      summaryExpense({
        id: "e4",
        lineItemId: "b",
        name: "Taxi",
        description: "Airport taxi",
        note: "Cash payment",
        date: "2097-03-15",
        subtotalCents: 6_000,
        noReceipt: true,
        noReceiptReason: "Receipt lost in mail",
      }),
    ];

    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth,
      monthExpenses,
      settings: NO_SETTINGS,
    });

    // Overview
    expect(facts.overview.expenseCount).toBe(3);
    expect(facts.overview.totalSpent).toEqual({ cents: 18_500, text: "$185.00" });
    expect(facts.overview.topLineItems).toEqual([
      { name: "Salary", spent: { cents: 12_500, text: "$125.00" } },
      { name: "Travel", spent: { cents: 6_000, text: "$60.00" } },
    ]);

    // Budget position
    const salaryBudget = facts.budget.lineItems.find((r) => r.name === "Salary")!;
    expect(salaryBudget.scheduled).toEqual({ cents: 200_000, text: "$2,000.00" });
    expect(salaryBudget.spentThisMonth).toEqual({ cents: 12_500, text: "$125.00" });
    expect(salaryBudget.spentToDate).toEqual({ cents: 70_500, text: "$705.00" });
    expect(salaryBudget.remaining).toEqual({ cents: 129_500, text: "$1,295.00" });
    expect(salaryBudget.percentComplete).toBe("35%");

    const travelBudget = facts.budget.lineItems.find((r) => r.name === "Travel")!;
    expect(travelBudget.scheduled).toEqual({ cents: 120_000, text: "$1,200.00" });
    expect(travelBudget.spentThisMonth).toEqual({ cents: 6_000, text: "$60.00" });
    expect(travelBudget.spentToDate).toEqual({ cents: 6_000, text: "$60.00" });
    expect(travelBudget.remaining).toEqual({ cents: 114_000, text: "$1,140.00" });
    expect(travelBudget.percentComplete).toBe("5%");

    expect(facts.budget.overall.approved).toEqual({ cents: 320_000, text: "$3,200.00" });
    expect(facts.budget.overall.spentToDate).toEqual({ cents: 76_500, text: "$765.00" });
    expect(facts.budget.overall.remaining).toEqual({ cents: 243_500, text: "$2,435.00" });
    expect(facts.budget.overall.percentComplete).toBe("24%");
    expect(facts.budget.overall.contractTotal).toEqual({ cents: 320_000, text: "$3,200.00" });

    // Changes from last month
    expect(facts.changes.previousMonthHadSpending).toBe(true);
    const salaryChange = facts.changes.lineItems.find((r) => r.name === "Salary")!;
    expect(salaryChange.previous).toEqual({ cents: 8_000, text: "$80.00" });
    expect(salaryChange.current).toEqual({ cents: 12_500, text: "$125.00" });
    expect(salaryChange.change).toEqual({ cents: 4_500, text: "$45.00" });
    expect(salaryChange.direction).toBe("up");
    expect(salaryChange.changePercent).toBe("56%");
    expect(salaryChange.noticeable).toBe(false); // $45.00 diff is under the $100.00 floor

    const travelChange = facts.changes.lineItems.find((r) => r.name === "Travel")!;
    expect(travelChange.previous).toEqual({ cents: 0, text: "$0.00" });
    expect(travelChange.current).toEqual({ cents: 6_000, text: "$60.00" });
    expect(travelChange.direction).toBe("up");
    expect(travelChange.changePercent).toBeNull();
    expect(travelChange.noticeable).toBe(true); // from nothing to something

    // Items to note
    expect(facts.itemsToNote.noReceipt).toEqual([
      { name: "Taxi", amount: { cents: 6_000, text: "$60.00" }, reason: "Receipt lost in mail" },
    ]);
    expect(facts.itemsToNote.refunds).toEqual([
      { name: "Consultant Refund", amount: { cents: -3_000, text: "-$30.00" } },
    ]);
    expect(facts.itemsToNote.notReimbursed).toEqual([
      {
        name: "Consultant Fee",
        receiptTotal: { cents: 17_000, text: "$170.00" },
        parts: [{ part: "tax", amount: { cents: 1_500, text: "$15.00" } }],
      },
    ]);

    // Spending detail (dates via formatDateShort)
    const salarySpending = facts.spending.find((r) => r.name === "Salary")!;
    expect(salarySpending.expenseCount).toBe(2);
    expect(salarySpending.payeeCount).toBe(2);
    expect(salarySpending.expenses[0]).toMatchObject({
      name: "Consultant Fee",
      date: "10 Mar 2097",
      amount: { cents: 15_500, text: "$155.00" },
    });
  });
});

describe("buildMonthFacts — U-4 zero-spend line items", () => {
  it("a line item with no spend and no expenses is in Budget position, not Spending", () => {
    const items: LineItemBudget[] = [
      lineItem({ id: "a", name: "Idle", scheduledValueCents: 100_000, sortOrder: 0 }),
    ];
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth: [],
      monthExpenses: [],
      settings: NO_SETTINGS,
    });
    expect(facts.spending).toEqual([]);
    expect(facts.budget.lineItems).toHaveLength(1);
    expect(facts.budget.lineItems[0].name).toBe("Idle");
    expect(facts.overview.topLineItems).toEqual([]);
  });

  it("a line item whose expenses net to zero (charge + refund) is kept in Spending (P2/net-zero rule)", () => {
    const items: LineItemBudget[] = [
      lineItem({ id: "a", name: "NetZero", scheduledValueCents: 100_000, sortOrder: 0 }),
    ];
    const expensesUpToMonth: ExpenseAmount[] = [
      expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: 5_000 }),
      expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: -5_000 }),
    ];
    const monthExpenses: SummaryExpense[] = [
      summaryExpense({ id: "e1", lineItemId: "a", name: "Charge", subtotalCents: 5_000 }),
      summaryExpense({ id: "e2", lineItemId: "a", name: "Refund", subtotalCents: -5_000 }),
    ];
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth,
      monthExpenses,
      settings: NO_SETTINGS,
    });
    expect(facts.spending).toHaveLength(1);
    expect(facts.spending[0].spent).toEqual({ cents: 0, text: "$0.00" });
    expect(facts.spending[0].expenses).toHaveLength(2);
    // The net-zero line item's spend is zero, so it never appears in Overview's non-zero list.
    expect(facts.overview.topLineItems).toEqual([]);
  });
});

describe("buildMonthFacts — U-5 refund-only month", () => {
  it("negative totals and strings are formatted with a leading minus", () => {
    const items: LineItemBudget[] = [
      lineItem({ id: "a", name: "Supplies", scheduledValueCents: 50_000, sortOrder: 0 }),
    ];
    const expensesUpToMonth: ExpenseAmount[] = [
      expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: -4_200 }),
    ];
    const monthExpenses: SummaryExpense[] = [
      summaryExpense({ id: "e1", lineItemId: "a", name: "Vendor Refund", subtotalCents: -4_200 }),
    ];
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth,
      monthExpenses,
      settings: NO_SETTINGS,
    });
    expect(facts.overview.totalSpent).toEqual({ cents: -4_200, text: "-$42.00" });
    expect(facts.spending[0].spent).toEqual({ cents: -4_200, text: "-$42.00" });
    expect(facts.itemsToNote.refunds).toEqual([
      { name: "Vendor Refund", amount: { cents: -4_200, text: "-$42.00" } },
    ]);
    // A negative-spend line item is still "topLineItems" material (non-zero, not necessarily positive).
    expect(facts.overview.topLineItems).toEqual([{ name: "Supplies", spent: { cents: -4_200, text: "-$42.00" } }]);
  });
});

describe("buildMonthFacts — U-6 excluded tax and fees", () => {
  it("spent = reimbursable (excludes non-reimbursed parts); exclusions are listed in itemsToNote", () => {
    const items: LineItemBudget[] = [
      lineItem({ id: "a", name: "Catering", scheduledValueCents: 100_000, sortOrder: 0 }),
    ];
    const expensesUpToMonth: ExpenseAmount[] = [
      expenseAmount({
        lineItemId: "a",
        month: "2097-03",
        subtotalCents: 10_000,
        taxCents: 800,
        feesCents: 200,
        taxReimbursable: false,
        feesReimbursable: false,
      }),
    ];
    const monthExpenses: SummaryExpense[] = [
      summaryExpense({
        id: "e1",
        lineItemId: "a",
        name: "Caterer",
        subtotalCents: 10_000,
        taxCents: 800,
        feesCents: 200,
        taxReimbursable: false,
        feesReimbursable: false,
      }),
    ];
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth,
      monthExpenses,
      settings: NO_SETTINGS,
    });
    // spend = subtotal only (10000), matching the Dashboard's spent figure, not the $11,000 receipt.
    expect(facts.spending[0].spent).toEqual({ cents: 10_000, text: "$100.00" });
    expect(facts.itemsToNote.notReimbursed).toEqual([
      {
        name: "Caterer",
        receiptTotal: { cents: 11_000, text: "$110.00" },
        parts: [
          { part: "tax", amount: { cents: 800, text: "$8.00" } },
          { part: "fees", amount: { cents: 200, text: "$2.00" } },
        ],
      },
    ]);
  });

  it("a refund's excluded parts are still listed (negative, not reimbursed) — excludedParts non-zero check, not positive check", () => {
    const items: LineItemBudget[] = [lineItem({ id: "a", name: "Supplies", scheduledValueCents: 50_000 })];
    const expensesUpToMonth: ExpenseAmount[] = [
      expenseAmount({
        lineItemId: "a",
        month: "2097-03",
        subtotalCents: -1_000,
        taxCents: -80,
        taxReimbursable: false,
      }),
    ];
    const monthExpenses: SummaryExpense[] = [
      summaryExpense({
        id: "e1",
        lineItemId: "a",
        name: "Refund",
        subtotalCents: -1_000,
        taxCents: -80,
        taxReimbursable: false,
      }),
    ];
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth,
      monthExpenses,
      settings: NO_SETTINGS,
    });
    expect(facts.itemsToNote.notReimbursed).toHaveLength(1);
    expect(facts.itemsToNote.notReimbursed[0].parts).toEqual([{ part: "tax", amount: { cents: -80, text: "-$0.80" } }]);
  });
});

describe("buildMonthFacts — U-7 no-receipt items", () => {
  it("carry their reason", () => {
    const items: LineItemBudget[] = [lineItem({ id: "a", name: "Misc", scheduledValueCents: 10_000 })];
    const monthExpenses: SummaryExpense[] = [
      summaryExpense({
        id: "e1",
        lineItemId: "a",
        name: "Cash purchase",
        subtotalCents: 500,
        noReceipt: true,
        noReceiptReason: "Vendor gave a handwritten note only",
      }),
    ];
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth: [expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: 500 })],
      monthExpenses,
      settings: NO_SETTINGS,
    });
    expect(facts.itemsToNote.noReceipt).toEqual([
      { name: "Cash purchase", amount: { cents: 500, text: "$5.00" }, reason: "Vendor gave a handwritten note only" },
    ]);
  });

  it("a null reason is cut to an empty string, not 'null'", () => {
    const items: LineItemBudget[] = [lineItem({ id: "a", name: "Misc", scheduledValueCents: 10_000 })];
    const monthExpenses: SummaryExpense[] = [
      summaryExpense({ id: "e1", lineItemId: "a", name: "X", subtotalCents: 100, noReceipt: true, noReceiptReason: null }),
    ];
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth: [expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: 100 })],
      monthExpenses,
      settings: NO_SETTINGS,
    });
    expect(facts.itemsToNote.noReceipt[0].reason).toBe("");
  });
});

describe("buildMonthFacts — U-9 previousMonthHadSpending flag", () => {
  it("false when nothing was spent the previous month", () => {
    const items: LineItemBudget[] = [lineItem({ id: "a", name: "Salary", scheduledValueCents: 100_000 })];
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth: [expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: 1_000 })],
      monthExpenses: [],
      settings: NO_SETTINGS,
    });
    expect(facts.changes.previousMonthHadSpending).toBe(false);
  });

  it("true when some line item spent in the previous month", () => {
    const items: LineItemBudget[] = [lineItem({ id: "a", name: "Salary", scheduledValueCents: 100_000 })];
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth: [expenseAmount({ lineItemId: "a", month: "2097-02", subtotalCents: 1_000 })],
      monthExpenses: [],
      settings: NO_SETTINGS,
    });
    expect(facts.changes.previousMonthHadSpending).toBe(true);
  });
});

describe("buildMonthFacts — U-10 P18 'noticeable' thresholds", () => {
  function changeFor(previousCents: number, currentCents: number) {
    const items: LineItemBudget[] = [lineItem({ id: "a", name: "X", scheduledValueCents: 1_000_000 })];
    const expensesUpToMonth: ExpenseAmount[] = [];
    if (previousCents !== 0) expensesUpToMonth.push(expenseAmount({ lineItemId: "a", month: "2097-02", subtotalCents: previousCents }));
    if (currentCents !== 0) expensesUpToMonth.push(expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: currentCents }));
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth,
      monthExpenses: [],
      settings: NO_SETTINGS,
    });
    return facts.changes.lineItems[0];
  }

  it("24.9% change (and >= $100) is NOT noticeable — under the 25% floor", () => {
    // previous $1,000.00 (100000c), diff must be >= 10000c to even reach the ratio check.
    // 24.9% of 100000 = 24900. diff 24900 >= 10000 (cents floor) but ratio 24.9% < 25%.
    const change = changeFor(100_000, 100_000 + 24_900);
    expect(change.noticeable).toBe(false);
  });

  it("exactly 25% change (and >= $100) IS noticeable", () => {
    const change = changeFor(100_000, 100_000 + 25_000);
    expect(change.noticeable).toBe(true);
  });

  it("$99.99 change (even if the ratio clears 25%) is NOT noticeable — under the $100 floor", () => {
    // previous $200.00, diff $99.99 = 49.995% ratio, but diff (9999c) < 10000c floor.
    const change = changeFor(20_000, 20_000 + 9_999);
    expect(change.noticeable).toBe(false);
  });

  it("exactly $100.00 change with a qualifying ratio IS noticeable", () => {
    // previous $200.00, diff $100.00 = 50% ratio, diff (10000c) >= 10000c floor.
    const change = changeFor(20_000, 20_000 + 10_000);
    expect(change.noticeable).toBe(true);
  });

  it("from nothing to something is noticeable regardless of size", () => {
    const change = changeFor(0, 1);
    expect(change.noticeable).toBe(true);
    expect(change.changePercent).toBeNull();
  });

  it("from something to nothing is noticeable regardless of size", () => {
    const change = changeFor(50_000, 0);
    expect(change.noticeable).toBe(true);
  });

  it("both months zero is NOT noticeable", () => {
    const change = changeFor(0, 0);
    expect(change.noticeable).toBe(false);
    expect(change.direction).toBe("none");
    expect(change.changePercent).toBeNull();
  });

  it("a negative-to-more-negative month (both refunds) computes noticeable off the absolute diff", () => {
    // previous -$500.00, current -$700.00: diff = 200.00 (>= $100), ratio = 200/500 = 40% (>= 25%).
    const change = changeFor(-50_000, -70_000);
    expect(change.direction).toBe("down");
    expect(change.change).toEqual({ cents: 20_000, text: "$200.00" });
    expect(change.noticeable).toBe(true);
  });
});

describe("buildMonthFacts — U-11 allowedAmounts / allowedPercents", () => {
  it("holds every formatted figure appearing anywhere in the facts, and nothing else", () => {
    const items: LineItemBudget[] = [
      lineItem({ id: "a", name: "Salary", scheduledValueCents: 200_000, sortOrder: 0 }),
      lineItem({ id: "b", name: "Travel", scheduledValueCents: 50_000, sortOrder: 1 }),
    ];
    const expensesUpToMonth: ExpenseAmount[] = [
      expenseAmount({ lineItemId: "a", month: "2097-02", subtotalCents: 3_000 }),
      expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: 5_000, taxCents: 400, taxReimbursable: false }),
      expenseAmount({ lineItemId: "b", month: "2097-03", subtotalCents: -1_000 }),
    ];
    const monthExpenses: SummaryExpense[] = [
      summaryExpense({
        id: "e1",
        lineItemId: "a",
        name: "Payroll",
        subtotalCents: 5_000,
        taxCents: 400,
        taxReimbursable: false,
        noReceipt: true,
        noReceiptReason: "lost",
      }),
      summaryExpense({ id: "e2", lineItemId: "b", name: "Refund", subtotalCents: -1_000 }),
    ];

    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth,
      monthExpenses,
      settings: NO_SETTINGS,
    });

    // Build the expected set independently by walking the facts object (not the allowed lists).
    const expectedAmounts = new Set<string>();
    expectedAmounts.add(facts.overview.totalSpent.text);
    for (const item of facts.overview.topLineItems) expectedAmounts.add(item.spent.text);
    for (const row of facts.spending) {
      expectedAmounts.add(row.spent.text);
      for (const expense of row.expenses) expectedAmounts.add(expense.amount.text);
    }
    for (const row of facts.budget.lineItems) {
      expectedAmounts.add(row.scheduled.text);
      expectedAmounts.add(row.spentThisMonth.text);
      expectedAmounts.add(row.spentToDate.text);
      expectedAmounts.add(row.remaining.text);
    }
    expectedAmounts.add(facts.budget.overall.approved.text);
    expectedAmounts.add(facts.budget.overall.spentToDate.text);
    expectedAmounts.add(facts.budget.overall.remaining.text);
    expectedAmounts.add(facts.budget.overall.contractTotal.text);
    for (const row of facts.changes.lineItems) {
      expectedAmounts.add(row.previous.text);
      expectedAmounts.add(row.current.text);
      expectedAmounts.add(row.change.text);
    }
    for (const row of facts.itemsToNote.noReceipt) expectedAmounts.add(row.amount.text);
    for (const row of facts.itemsToNote.refunds) expectedAmounts.add(row.amount.text);
    for (const row of facts.itemsToNote.notReimbursed) {
      expectedAmounts.add(row.receiptTotal.text);
      for (const part of row.parts) expectedAmounts.add(part.amount.text);
    }

    const expectedPercents = new Set<string>();
    for (const row of facts.budget.lineItems) expectedPercents.add(row.percentComplete);
    expectedPercents.add(facts.budget.overall.percentComplete);
    for (const row of facts.changes.lineItems) if (row.changePercent !== null) expectedPercents.add(row.changePercent);

    expect(facts.allowedAmounts).toEqual([...expectedAmounts].sort());
    expect(facts.allowedPercents).toEqual([...expectedPercents].sort());
    // Sanity: not empty, and every entry is unique (Set dedup honoured).
    expect(facts.allowedAmounts.length).toBe(new Set(facts.allowedAmounts).size);
    expect(facts.allowedPercents.length).toBe(new Set(facts.allowedPercents).size);
  });

  it("an empty month (no line items, no expenses) has empty allowed lists except the zero total", () => {
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: [],
      expensesUpToMonth: [],
      monthExpenses: [],
      settings: NO_SETTINGS,
    });
    expect(facts.allowedAmounts).toEqual(["$0.00"]); // overview.totalSpent and overall figures collapse to $0.00
    expect(facts.allowedPercents).toEqual(["0%"]); // overall.percentComplete on a $0 budget
  });
});

describe("P16 — field cut at exactly SUMMARY_FIELD_MAX_CHARS", () => {
  function factsWithDescription(description: string) {
    const items: LineItemBudget[] = [lineItem({ id: "a", name: "X", scheduledValueCents: 10_000 })];
    const monthExpenses: SummaryExpense[] = [
      summaryExpense({ id: "e1", lineItemId: "a", name: "E", subtotalCents: 100, description }),
    ];
    return buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth: [expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: 100 })],
      monthExpenses,
      settings: NO_SETTINGS,
    });
  }

  it("exactly 1000 code points is left untouched", () => {
    const text = "a".repeat(SUMMARY_FIELD_MAX_CHARS);
    const facts = factsWithDescription(text);
    expect(facts.spending[0].expenses[0].description).toBe(text);
    expect(facts.spending[0].expenses[0].description.endsWith("…[cut]")).toBe(false);
  });

  it("1001 code points is cut to 1000 plus the marker", () => {
    const text = "a".repeat(SUMMARY_FIELD_MAX_CHARS + 1);
    const facts = factsWithDescription(text);
    const result = facts.spending[0].expenses[0].description;
    expect(result).toBe(`${"a".repeat(SUMMARY_FIELD_MAX_CHARS)}…[cut]`);
  });

  it("an emoji (surrogate pair) sitting exactly at the boundary is not split in half", () => {
    // 999 plain chars + one 2-code-unit emoji = 1000 code points exactly (Array.from counts it as one).
    const text = `${"a".repeat(SUMMARY_FIELD_MAX_CHARS - 1)}🎉`;
    expect(Array.from(text)).toHaveLength(SUMMARY_FIELD_MAX_CHARS);
    const facts = factsWithDescription(text);
    const result = facts.spending[0].expenses[0].description;
    expect(result).toBe(text); // exactly at the limit → untouched, emoji intact
    expect(result.endsWith("🎉")).toBe(true);

    // One more character pushes it over: the emoji must remain whole in the truncated output,
    // never split into a lone unpaired surrogate.
    const overText = `${"a".repeat(SUMMARY_FIELD_MAX_CHARS - 1)}🎉b`;
    const overResult = factsWithDescription(overText).spending[0].expenses[0].description;
    expect(overResult).toBe(`${"a".repeat(SUMMARY_FIELD_MAX_CHARS - 1)}🎉…[cut]`);
    expect(overResult).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // no lone high surrogate
  });
});

describe("P16 — expense names are cut in Items to note too", () => {
  it("no-receipt, refund and not-reimbursed names are cut like the spending section's", () => {
    const longName = "n".repeat(SUMMARY_FIELD_MAX_CHARS + 5);
    const cut = `${"n".repeat(SUMMARY_FIELD_MAX_CHARS)}…[cut]`;
    const facts = buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: [lineItem({ id: "a", name: "X", scheduledValueCents: 10_000 })],
      expensesUpToMonth: [expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: -100 })],
      monthExpenses: [
        summaryExpense({
          id: "e1",
          lineItemId: "a",
          name: longName,
          subtotalCents: -100,
          taxCents: 50,
          noReceipt: true,
          noReceiptReason: "lost",
        }),
      ],
      settings: NO_SETTINGS,
    });
    expect(facts.itemsToNote.noReceipt[0].name).toBe(cut);
    expect(facts.itemsToNote.refunds[0].name).toBe(cut);
    expect(facts.itemsToNote.notReimbursed[0].name).toBe(cut);
  });
});

describe("serializeFactsForPrompt", () => {
  const items: LineItemBudget[] = [lineItem({ id: "a", name: "X", scheduledValueCents: 10_000 })];
  function baseFacts(monthExpenses: SummaryExpense[]) {
    return buildMonthFacts({
      orgDocName: ORG_DOC_NAME,
      source: SOURCE,
      month: "2097-03",
      lineItems: items,
      expensesUpToMonth: [expenseAmount({ lineItemId: "a", month: "2097-03", subtotalCents: 100 })],
      monthExpenses,
      settings: NO_SETTINGS,
    });
  }

  it("under the limit: full payload, not flagged, and never contains a raw 'cents' key", () => {
    const facts = baseFacts([summaryExpense({ id: "e1", lineItemId: "a", name: "E", subtotalCents: 100 })]);
    const { text, expenseDetailDropped } = serializeFactsForPrompt(facts);
    expect(expenseDetailDropped).toBe(false);
    expect(text).not.toContain('"cents"');
    expect(text).toContain("$1.00"); // the reimbursable amount, as text
    const parsed = JSON.parse(text);
    expect(parsed.spending[0].expenses).toHaveLength(1);
    expect(parsed.allowedAmounts).toBeUndefined(); // never the verifier's answer key
    expect(parsed.allowedPercents).toBeUndefined();
  });

  it("over a small maxChars: falls back to per-line-item facts only, flagged, still no 'cents' key", () => {
    const facts = baseFacts([summaryExpense({ id: "e1", lineItemId: "a", name: "E", subtotalCents: 100 })]);
    const { text, expenseDetailDropped } = serializeFactsForPrompt(facts, 50);
    expect(expenseDetailDropped).toBe(true);
    expect(text).not.toContain('"cents"');
    const parsed = JSON.parse(text);
    expect(parsed.spending[0].expenses).toEqual([]);
  });

  it("when dropping spending's expense detail alone still exceeds maxChars, itemsToNote's noReceipt/refund names and no-receipt reasons are cleared too, but every amount survives (second fallback)", () => {
    const longName = "n".repeat(SUMMARY_FIELD_MAX_CHARS);
    const longReason = "r".repeat(SUMMARY_FIELD_MAX_CHARS);
    const monthExpenses: SummaryExpense[] = [
      summaryExpense({
        id: "e1",
        lineItemId: "a",
        name: longName,
        subtotalCents: 500,
        noReceipt: true,
        noReceiptReason: longReason,
      }),
      summaryExpense({ id: "e2", lineItemId: "a", name: `${longName}b`, subtotalCents: -300 }), // refund
      summaryExpense({
        id: "e3",
        lineItemId: "a",
        name: `${longName}c`,
        subtotalCents: 100,
        taxCents: 50,
        taxReimbursable: false,
      }),
    ];
    const facts = baseFacts(monthExpenses);

    // A small maxChars: even after the first fallback (spending.expenses -> []), itemsToNote's
    // three ~1000-char names/reasons alone still blow past it, forcing the second fallback.
    const { text, expenseDetailDropped } = serializeFactsForPrompt(facts, 200);
    expect(expenseDetailDropped).toBe(true);
    expect(text).not.toContain('"cents"');
    const parsed = JSON.parse(text);

    expect(parsed.spending[0].expenses).toEqual([]); // first fallback still applied

    expect(parsed.itemsToNote.noReceipt[0].name).toBe("");
    expect(parsed.itemsToNote.noReceipt[0].reason).toBe("");
    expect(parsed.itemsToNote.noReceipt[0].amount).toBe(facts.itemsToNote.noReceipt[0].amount.text);

    expect(parsed.itemsToNote.refunds[0].name).toBe("");
    expect(parsed.itemsToNote.refunds[0].amount).toBe(facts.itemsToNote.refunds[0].amount.text);

    // notReimbursed's name is left untouched by this fallback (the code only clears
    // noReceipt/refunds) — documenting the real behaviour rather than assuming symmetry.
    expect(parsed.itemsToNote.notReimbursed[0].name).toBe(facts.itemsToNote.notReimbursed[0].name);
    expect(parsed.itemsToNote.notReimbursed[0].receiptTotal).toBe(
      facts.itemsToNote.notReimbursed[0].receiptTotal.text,
    );
  });

  it("a 300-expense month with long narratives completes and each narrative is independently cut (U-17)", () => {
    const monthExpenses: SummaryExpense[] = Array.from({ length: 300 }, (_, i) =>
      summaryExpense({
        id: `e${i}`,
        lineItemId: "a",
        name: `Expense ${i}`,
        subtotalCents: 10,
        narrative: "n".repeat(SUMMARY_FIELD_MAX_CHARS + 50),
      }),
    );
    const facts = baseFacts(monthExpenses);
    expect(facts.spending[0].expenses).toHaveLength(300);
    for (const expense of facts.spending[0].expenses) {
      expect(expense.narrative).toBe(`${"n".repeat(SUMMARY_FIELD_MAX_CHARS)}…[cut]`);
    }
    const { text, expenseDetailDropped } = serializeFactsForPrompt(facts);
    expect(expenseDetailDropped).toBe(true); // 300 * ~1000 chars comfortably exceeds 120,000
    expect(text.length).toBeLessThanOrEqual(SUMMARY_FACTS_MAX_CHARS * 2); // sane, not runaway
  });
});
