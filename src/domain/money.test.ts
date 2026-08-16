import { describe, expect, it } from "vitest";

import {
  centsToDollars,
  parseMoneyToCents,
  parseMoneyToCentsOrZero,
  reimbursableCents,
  sumBy,
  sumCents,
} from "./money";

describe("parseMoneyToCents (R1.1)", () => {
  it("parses the shapes people type", () => {
    expect(parseMoneyToCents("9211.50")).toBe(921150);
    expect(parseMoneyToCents("9,211.50")).toBe(921150);
    expect(parseMoneyToCents("$9,211.50")).toBe(921150);
    expect(parseMoneyToCents(" $9,211.50 ")).toBe(921150);
    expect(parseMoneyToCents("0")).toBe(0);
    expect(parseMoneyToCents(".5")).toBe(50);
    expect(parseMoneyToCents("1234")).toBe(123400);
  });

  it("parses negatives, including accounting parentheses (R1.4)", () => {
    expect(parseMoneyToCents("-145")).toBe(-14500);
    expect(parseMoneyToCents("-$145.00")).toBe(-14500);
    expect(parseMoneyToCents("(145.00)")).toBe(-14500);
    expect(parseMoneyToCents("($145.00)")).toBe(-14500);
  });

  it("distinguishes invalid input from zero", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("   ")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("1.2.3")).toBeNull();
    expect(parseMoneyToCents(".")).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
    expect(parseMoneyToCents(undefined)).toBeNull();
    expect(parseMoneyToCents(Number.NaN)).toBeNull();
    expect(parseMoneyToCents("0")).toBe(0);
  });

  it("rejects absurd magnitudes rather than losing precision", () => {
    expect(parseMoneyToCents("99999999999999")).toBeNull();
  });

  it("rounds to whole cents without binary-float drift", () => {
    expect(parseMoneyToCents("8.115")).toBe(812);
    expect(parseMoneyToCents("0.005")).toBe(1);
    expect(parseMoneyToCents(19.99)).toBe(1999);
    expect(parseMoneyToCents(1.005)).toBe(101);
  });

  it("treats blanks as zero when the caller opts in", () => {
    expect(parseMoneyToCentsOrZero("")).toBe(0);
    expect(parseMoneyToCentsOrZero("12.34")).toBe(1234);
  });
});

describe("arithmetic", () => {
  it("sums, netting negatives (R1.4)", () => {
    expect(sumCents(100, 200, -50)).toBe(250);
    expect(sumCents()).toBe(0);
    expect(sumCents(null, undefined, 7)).toBe(7);
  });

  it("sums by projection", () => {
    const rows = [{ n: 921150 }, { n: 759616 }, { n: -14500 }];
    expect(sumBy(rows, (r) => r.n)).toBe(1666266);
    expect(sumBy([], (r: { n: number }) => r.n)).toBe(0);
  });

  it("converts to dollars for spreadsheet cells", () => {
    expect(centsToDollars(921150)).toBe(9211.5);
    expect(centsToDollars(-14500)).toBe(-145);
    expect(centsToDollars(0)).toBe(0);
  });
});

describe("reimbursableCents (R1.3)", () => {
  it("is subtotal plus fees, excluding tax", () => {
    expect(reimbursableCents({ subtotalCents: 921150, feesCents: 0 })).toBe(921150);
    expect(reimbursableCents({ subtotalCents: 4990, feesCents: 250 })).toBe(5240);
  });

  it("ignores tax entirely even when large", () => {
    // Real case: FedEx $49.90 subtotal + $3.50 tax reimburses $49.90.
    const expense = { subtotalCents: 4990, taxCents: 350, feesCents: 0 };
    expect(reimbursableCents(expense)).toBe(4990);
  });

  it("supports refunds", () => {
    expect(reimbursableCents({ subtotalCents: -14500, feesCents: 0 })).toBe(-14500);
  });
});
