import { describe, expect, it } from "vitest";

import { lookupKey, priceCents, PRICES_CENTS } from "./pricing";

describe("lookupKey", () => {
  it("matches what billing:setup creates", () => {
    expect(lookupKey("reconciliation_ai", "year")).toBe("reconciliation_ai_year");
    expect(lookupKey("reconciliation", "month")).toBe("reconciliation_month");
  });
});

describe("priceCents", () => {
  it("reads straight from PRICES_CENTS", () => {
    expect(priceCents("reconciliation", "month")).toBe(PRICES_CENTS.reconciliation.month);
    expect(priceCents("reconciliation_ai", "year")).toBe(PRICES_CENTS.reconciliation_ai.year);
  });

  it("matches the constants named in the plan (C7)", () => {
    expect(priceCents("reconciliation", "month")).toBe(29_700);
    expect(priceCents("reconciliation_ai", "month")).toBe(49_700);
    expect(priceCents("reconciliation", "year")).toBe(356_400);
    expect(priceCents("reconciliation_ai", "year")).toBe(596_400);
  });

  it("every price is an integer number of cents", () => {
    for (const plan of ["reconciliation", "reconciliation_ai"] as const) {
      for (const interval of ["month", "year"] as const) {
        expect(Number.isInteger(priceCents(plan, interval)), `${plan}/${interval}`).toBe(true);
      }
    }
  });

  it("yearly is exactly 12 × monthly until someone changes it (O1)", () => {
    expect(PRICES_CENTS.reconciliation.year).toBe(PRICES_CENTS.reconciliation.month * 12);
    expect(PRICES_CENTS.reconciliation_ai.year).toBe(PRICES_CENTS.reconciliation_ai.month * 12);
  });
});

describe("lookupKey: all 4 plan/interval combinations", () => {
  it("is unique per combination and stable", () => {
    const keys = new Set<string>();
    for (const plan of ["reconciliation", "reconciliation_ai"] as const) {
      for (const interval of ["month", "year"] as const) {
        keys.add(lookupKey(plan, interval));
      }
    }
    expect(keys).toEqual(
      new Set(["reconciliation_month", "reconciliation_year", "reconciliation_ai_month", "reconciliation_ai_year"]),
    );
  });
});
