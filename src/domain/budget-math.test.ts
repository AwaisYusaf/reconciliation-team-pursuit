import { describe, expect, it } from "vitest";

import {
  allLineItemStats,
  isLowBudget,
  lineItemStats,
  LOW_BUDGET_THRESHOLD,
  projectedRemainingCents,
  type ExpenseAmount,
  type LineItemBudget,
} from "./budget-math";
import { FEB, FEB_EXPENSES, JAN, LINE_ITEMS, MAR } from "./fixtures";
import { formatMoney, formatPercent } from "./format";

const salary = LINE_ITEMS[0];

describe("lineItemStats (R3.1–R3.5)", () => {
  it("reproduces the published February figures", () => {
    const stats = lineItemStats(salary, FEB_EXPENSES, FEB);

    expect(formatMoney(stats.previouslyBilledCents)).toBe("$350,000.00");
    expect(formatMoney(stats.spentThisMonthCents)).toBe("$45,641.12");
    expect(formatMoney(stats.totalBilledCents)).toBe("$395,641.12");
    expect(formatMoney(stats.remainingCents)).toBe("$63,051.34");
    expect(formatPercent(stats.percentComplete)).toBe("86%");
  });

  it("reproduces every dashboard row", () => {
    const rows = allLineItemStats(LINE_ITEMS, FEB_EXPENSES, FEB);
    const rendered = rows.map((row) => [
      row.lineItem.name,
      formatMoney(row.spentThisMonthCents),
      formatMoney(row.totalBilledCents),
      formatMoney(row.remainingCents),
    ]);

    expect(rendered).toEqual([
      ["Salary", "$45,641.12", "$395,641.12", "$63,051.34"],
      ["Analytical Support", "$19,890.83", "$59,890.83", "$7,038.31"],
      ["Promotional & Marketing", "$11,851.65", "$60,050.16", "-$1,837.54"],
      ["Social Services & Support", "$10,231.08", "$40,231.08", "$1,018.92"],
      ["Community Programs & Events", "$4,251.28", "$18,237.24", "$21,595.21"],
      ["Professional Development", "$1,599.00", "$3,348.00", "$11,652.00"],
    ]);
  });

  it("adds earlier months to the opening balance (R3.1)", () => {
    const expenses: ExpenseAmount[] = [
      { lineItemId: "salary", month: JAN, subtotalCents: 100000, feesCents: 0 },
      { lineItemId: "salary", month: FEB, subtotalCents: 200000, feesCents: 0 },
    ];
    const stats = lineItemStats(salary, expenses, FEB);

    expect(stats.previouslyBilledCents).toBe(35000000 + 100000);
    expect(stats.spentThisMonthCents).toBe(200000);
    expect(stats.totalBilledCents).toBe(35300000);
  });

  it("excludes months after the reporting month — they are not billed yet", () => {
    const expenses: ExpenseAmount[] = [
      { lineItemId: "salary", month: FEB, subtotalCents: 200000, feesCents: 0 },
      { lineItemId: "salary", month: MAR, subtotalCents: 999999, feesCents: 0 },
    ];
    const stats = lineItemStats(salary, expenses, FEB);

    expect(stats.spentThisMonthCents).toBe(200000);
    expect(stats.totalBilledCents).toBe(35200000);
  });

  it("ignores other line items' expenses", () => {
    const expenses: ExpenseAmount[] = [
      { lineItemId: "analytical", month: FEB, subtotalCents: 500000, feesCents: 0 },
    ];
    expect(lineItemStats(salary, expenses, FEB).spentThisMonthCents).toBe(0);
  });

  it("includes fees and excludes tax (R1.3)", () => {
    const expenses: ExpenseAmount[] = [
      { lineItemId: "salary", month: FEB, subtotalCents: 4990, feesCents: 250 },
    ];
    expect(lineItemStats(salary, expenses, FEB).spentThisMonthCents).toBe(5240);
  });

  it("nets refunds (R1.4)", () => {
    const expenses: ExpenseAmount[] = [
      { lineItemId: "salary", month: FEB, subtotalCents: 100000, feesCents: 0 },
      { lineItemId: "salary", month: FEB, subtotalCents: -14500, feesCents: 0 },
    ];
    expect(lineItemStats(salary, expenses, FEB).spentThisMonthCents).toBe(85500);
  });

  it("reports 0% rather than dividing by zero", () => {
    const zeroBudget: LineItemBudget = { ...salary, scheduledValueCents: 0, openingBilledCents: 0 };
    const stats = lineItemStats(zeroBudget, [], FEB);
    expect(stats.percentComplete).toBe(0);
    expect(formatPercent(stats.percentComplete)).toBe("0%");
  });

  it("orders rows by the organisation's configured sort order", () => {
    const shuffled = [LINE_ITEMS[3], LINE_ITEMS[0], LINE_ITEMS[5]];
    expect(allLineItemStats(shuffled, [], FEB).map((row) => row.lineItem.name)).toEqual([
      "Salary",
      "Social Services & Support",
      "Professional Development",
    ]);
  });
});

describe("low-budget warning (R3.6)", () => {
  it("triggers strictly below 10% remaining", () => {
    expect(LOW_BUDGET_THRESHOLD).toBe(0.1);
    expect(isLowBudget(1000, 10000)).toBe(false); // exactly 10%
    expect(isLowBudget(999, 10000)).toBe(true);
    expect(isLowBudget(1001, 10000)).toBe(false);
    expect(isLowBudget(-1, 10000)).toBe(true);
  });

  it("flags the same rows the approved dashboard flags, and no others", () => {
    const flagged = allLineItemStats(LINE_ITEMS, FEB_EXPENSES, FEB)
      .filter((row) => row.isLowBudget)
      .map((row) => row.lineItem.name);

    // Analytical Support sits at 10.5% remaining, so it must NOT be flagged — the defect
    // the adversarial review caught in the original design prompt (finding B6).
    expect(flagged).toEqual(["Promotional & Marketing", "Social Services & Support"]);
  });

  it("with no budget, flags only an overspend", () => {
    expect(isLowBudget(0, 0)).toBe(false);
    expect(isLowBudget(-100, 0)).toBe(true);
    expect(isLowBudget(500, 0)).toBe(false);
  });
});

describe("projectedRemainingCents (R3.7)", () => {
  it("subtracts the amount being entered", () => {
    expect(
      projectedRemainingCents({ remainingCents: 6305134, formReimbursableCents: 921150 }),
    ).toBe(5383984);
  });

  it("goes negative when the entry would overspend", () => {
    expect(projectedRemainingCents({ remainingCents: 5000, formReimbursableCents: 7500 })).toBe(
      -2500,
    );
  });

  it("does not double-count the expense being edited", () => {
    // Saved amount $100 already reduced remaining to $900 of a $1,000 budget.
    // Editing it to $150 must project $850, not $750.
    expect(
      projectedRemainingCents({
        remainingCents: 90000,
        formReimbursableCents: 15000,
        editingExistingCents: 10000,
      }),
    ).toBe(85000);
  });

  it("is unchanged when an edit leaves the amount alone", () => {
    expect(
      projectedRemainingCents({
        remainingCents: 90000,
        formReimbursableCents: 10000,
        editingExistingCents: 10000,
      }),
    ).toBe(90000);
  });
});
