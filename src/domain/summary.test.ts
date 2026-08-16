import { describe, expect, it } from "vitest";

import { FEB, FEB_EXPENSES, LINE_ITEMS, SETTINGS } from "./fixtures";
import { formatMoney, formatPercent } from "./format";
import { contractSummary, PERFORMANCE_GRANT_LABEL } from "./summary";

const summary = contractSummary({
  lineItems: LINE_ITEMS,
  expenses: FEB_EXPENSES,
  settings: SETTINGS,
  month: FEB,
});

describe("contract summary (R7.1–R7.3)", () => {
  it("reproduces the published BASE rows exactly", () => {
    const rendered = summary.baseRows.map((row) => [
      row.name,
      formatMoney(row.scheduledCents),
      formatMoney(row.previouslyBilledCents),
      formatMoney(row.thisPeriodCents),
      formatMoney(row.totalBilledCents),
      formatPercent(row.percentComplete),
      formatMoney(row.balanceCents),
    ]);

    expect(rendered).toEqual([
      ["Salary", "$458,692.46", "$350,000.00", "$45,641.12", "$395,641.12", "86%", "$63,051.34"],
      ["Analytical Support", "$66,929.14", "$40,000.00", "$19,890.83", "$59,890.83", "89%", "$7,038.31"],
      ["Promotional & Marketing", "$58,212.62", "$48,198.51", "$11,851.65", "$60,050.16", "103%", "-$1,837.54"],
      ["Social Services & Support", "$41,250.00", "$30,000.00", "$10,231.08", "$40,231.08", "98%", "$1,018.92"],
      ["Community Programs & Events", "$39,832.45", "$13,985.96", "$4,251.28", "$18,237.24", "46%", "$21,595.21"],
      ["Professional Development", "$15,000.00", "$1,749.00", "$1,599.00", "$3,348.00", "22%", "$11,652.00"],
    ]);
  });

  it("reproduces the base subtotal", () => {
    const { baseSubtotal } = summary;
    expect(formatMoney(baseSubtotal.scheduledCents)).toBe("$679,916.67");
    expect(formatMoney(baseSubtotal.previouslyBilledCents)).toBe("$483,933.47");
    expect(formatMoney(baseSubtotal.thisPeriodCents)).toBe("$93,464.96");
    expect(formatMoney(baseSubtotal.totalBilledCents)).toBe("$577,398.43");
    expect(formatPercent(baseSubtotal.percentComplete)).toBe("85%");
    expect(formatMoney(baseSubtotal.balanceCents)).toBe("$102,518.24");
  });

  it("carries the performance grant from settings, never billing it in-system (R7.2)", () => {
    const { performanceRow } = summary;
    expect(performanceRow.name).toBe(PERFORMANCE_GRANT_LABEL);
    expect(formatMoney(performanceRow.scheduledCents)).toBe("$175,000.00");
    expect(formatMoney(performanceRow.previouslyBilledCents)).toBe("$39,229.50");
    expect(performanceRow.thisPeriodCents).toBe(0);
    expect(formatPercent(performanceRow.percentComplete)).toBe("22%");
    expect(formatMoney(performanceRow.balanceCents)).toBe("$135,770.50");
  });

  it("reproduces the totals row", () => {
    const { totals } = summary;
    expect(formatMoney(totals.scheduledCents)).toBe("$854,916.67");
    expect(formatMoney(totals.previouslyBilledCents)).toBe("$523,162.97");
    expect(formatMoney(totals.thisPeriodCents)).toBe("$93,464.96");
    expect(formatMoney(totals.totalBilledCents)).toBe("$616,627.93");
    expect(formatPercent(totals.percentComplete)).toBe("72%");
    expect(formatMoney(totals.balanceCents)).toBe("$238,288.74");
  });

  it("totals are base plus performance, to the cent", () => {
    expect(summary.totals.scheduledCents).toBe(
      summary.baseSubtotal.scheduledCents + summary.performanceRow.scheduledCents,
    );
    expect(summary.totals.totalBilledCents).toBe(
      summary.baseSubtotal.totalBilledCents + summary.performanceRow.totalBilledCents,
    );
  });
});

describe("advance reconciliation (R7.4)", () => {
  it("reproduces the published block", () => {
    const { reconciliation } = summary;
    expect(formatMoney(reconciliation.advancesCents)).toBe("$665,000.00");
    expect(formatMoney(reconciliation.reconciledCents)).toBe("$616,627.93");
    expect(formatMoney(reconciliation.balanceCents)).toBe("$48,372.07");
    expect(formatPercent(reconciliation.percentReconciled)).toBe("93%");
  });

  it("reconciles against the grand total billed, not the base alone", () => {
    expect(summary.reconciliation.reconciledCents).toBe(summary.totals.totalBilledCents);
  });

  it("reports 0% when no advances have been received", () => {
    const noAdvances = contractSummary({
      lineItems: LINE_ITEMS,
      expenses: FEB_EXPENSES,
      settings: { ...SETTINGS, advancesReceivedCents: 0 },
      month: FEB,
    });
    expect(noAdvances.reconciliation.percentReconciled).toBe(0);
    expect(formatMoney(noAdvances.reconciliation.balanceCents)).toBe("-$616,627.93");
  });
});

describe("contract total (R7.3)", () => {
  it("uses the configured value when set", () => {
    expect(formatMoney(summary.contractTotalCents)).toBe("$940,000.00");
  });

  it("falls back to the sum of scheduled values when unset", () => {
    const derived = contractSummary({
      lineItems: LINE_ITEMS,
      expenses: FEB_EXPENSES,
      settings: { ...SETTINGS, contractValueCents: 0 },
      month: FEB,
    });
    expect(formatMoney(derived.contractTotalCents)).toBe("$854,916.67");
    expect(derived.contractTotalCents).toBe(derived.totals.scheduledCents);
  });
});

describe("edge cases", () => {
  it("handles an organisation with no line items", () => {
    const empty = contractSummary({
      lineItems: [],
      expenses: [],
      settings: { ...SETTINGS, perfGrantScheduledCents: 0, perfGrantBilledCents: 0 },
      month: FEB,
    });
    expect(empty.baseRows).toEqual([]);
    expect(empty.baseSubtotal.scheduledCents).toBe(0);
    expect(formatPercent(empty.totals.percentComplete)).toBe("0%");
  });

  it("agrees with the dashboard for the same data (R10.2)", () => {
    // The summary's "This Period" per line item must equal the dashboard's "Spent This
    // Month" — they share one calculation service, and this proves it.
    const salaryRow = summary.baseRows.find((row) => row.name === "Salary");
    expect(formatMoney(salaryRow!.thisPeriodCents)).toBe("$45,641.12");
  });
});
