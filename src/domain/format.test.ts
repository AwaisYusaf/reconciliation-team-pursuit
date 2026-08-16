import { describe, expect, it } from "vitest";

import { formatMoney, formatPercent, percentValue, ratio, roundHalfAwayFromZero } from "./format";

describe("formatMoney (R1.2)", () => {
  it("always shows two decimals and thousands separators", () => {
    expect(formatMoney(921150)).toBe("$9,211.50");
    expect(formatMoney(1989083)).toBe("$19,890.83");
    expect(formatMoney(45864246)).toBe("$458,642.46");
    expect(formatMoney(500)).toBe("$5.00");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(5)).toBe("$0.05");
  });

  it("puts the sign before the dollar mark for negatives", () => {
    expect(formatMoney(-183754)).toBe("-$1,837.54");
    expect(formatMoney(-14500)).toBe("-$145.00");
  });

  it("formats the real February figures the way the packet does", () => {
    // From docs/03-modules/m07 sample: figures that must read identically everywhere.
    expect(formatMoney(67991667)).toBe("$679,916.67");
    expect(formatMoney(94000000)).toBe("$940,000.00");
    expect(formatMoney(4837207)).toBe("$48,372.07");
  });
});

describe("percentages (R1.5)", () => {
  it("renders whole numbers", () => {
    expect(formatPercent(0.8625)).toBe("86%");
    expect(formatPercent(1.0316)).toBe("103%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("rounds half away from zero", () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(percentValue(0.225)).toBe(23);
    expect(percentValue(-0.225)).toBe(-23);
  });

  it("treats division by zero as 0%", () => {
    expect(formatPercent(ratio(100, 0))).toBe("0%");
    expect(formatPercent(Number.NaN)).toBe("0%");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("0%");
    expect(ratio(0, 0)).toBe(0);
  });

  it("reproduces every percentage on the February contract summary", () => {
    const rows: Array<[number, number, string]> = [
      [39564112, 45869246, "86%"],
      [5989083, 6692914, "89%"],
      [6005016, 5821262, "103%"],
      [4023108, 4125000, "98%"],
      [1823724, 3983245, "46%"],
      [334800, 1500000, "22%"],
      [57739843, 67991667, "85%"],
      [3922950, 17500000, "22%"],
      [61662793, 85491667, "72%"],
      [61662793, 66500000, "93%"],
    ];
    for (const [billed, scheduled, expected] of rows) {
      expect(formatPercent(ratio(billed, scheduled))).toBe(expected);
    }
  });
});

/**
 * Exact half-way percentages are the case binary floating point gets wrong: 2300/4000 is
 * mathematically 57.5%, but the double nearest 0.575 times 100 is 57.49999999999999, which
 * rounds down. R1.5 requires 58, and Excel — which normalises to 15 significant digits
 * before rounding — prints 58 in the same cell, so getting this wrong made the Contract
 * Summary screen and the workbook disagree (R10.2).
 */
describe("percentages that land exactly on a half (R1.5)", () => {
  const cases: Array<[numeratorCents: number, denominatorCents: number, expected: string]> = [
    [230_000, 400_000, "58%"], // 57.5
    [410_000, 400_000, "103%"], // 102.5
    [145_000, 1_000_000, "15%"], // 14.5
    [565_000, 1_000_000, "57%"], // 56.5 -> 57
    [285_000, 1_000_000, "29%"], // 28.5
    [5_000, 1_000_000, "1%"], // 0.5
  ];

  for (const [numerator, denominator, expected] of cases) {
    it(`${numerator}/${denominator} renders ${expected}`, () => {
      expect(formatPercent(ratio(numerator, denominator))).toBe(expected);
    });
  }

  it("still rounds a genuine sub-half fraction down", () => {
    // 57.4999% is really below the boundary and must not be nudged up.
    expect(formatPercent(0.574999)).toBe("57%");
  });

  it("rounds negative halves away from zero too", () => {
    expect(formatPercent(-0.575)).toBe("-58%");
  });
});
