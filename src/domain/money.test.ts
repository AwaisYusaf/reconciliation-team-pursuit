import { describe, expect, it } from "vitest";

import {
  centsToDollars,
  excludedParts,
  parseMoneyToCents,
  parseMoneyToCentsOrZero,
  receiptTotalCents,
  reimbursableCents,
  sanitiseMoneyInput,
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

  it("reads a decimal comma as the cents, never as a thousands separator (Phase 0 B1)", () => {
    expect(parseMoneyToCents("12,50")).toBe(1250); // was $1,250.00
    expect(parseMoneyToCents("12,5")).toBe(1250);
    expect(parseMoneyToCents(",50")).toBe(50);
    expect(parseMoneyToCents("$12,50")).toBe(1250);
    expect(parseMoneyToCents("-12,50")).toBe(-1250);
    expect(parseMoneyToCents("(12,50)")).toBe(-1250);
    expect(parseMoneyToCentsOrZero("7,05")).toBe(705);
  });

  it("still reads a comma before three digits, or alongside a dot, as thousands", () => {
    expect(parseMoneyToCents("1,250")).toBe(125000);
    expect(parseMoneyToCents("12,345,678")).toBe(1234567800);
    expect(parseMoneyToCents("1,250.50")).toBe(125050);
    expect(parseMoneyToCents("1,25.00")).toBe(12500);
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
    expect(reimbursableCents({ subtotalCents: 921150, taxCents: 0, feesCents: 0 , taxReimbursable: false, feesReimbursable: true})).toBe(921150);
    expect(reimbursableCents({ subtotalCents: 4990, taxCents: 0, feesCents: 250 , taxReimbursable: false, feesReimbursable: true})).toBe(5240);
  });

  it("ignores tax entirely even when large", () => {
    // Real case: FedEx $49.90 subtotal + $3.50 tax reimburses $49.90.
    const expense = { subtotalCents: 4990, taxCents: 350, feesCents: 0 , taxReimbursable: false, feesReimbursable: true};
    expect(reimbursableCents(expense)).toBe(4990);
  });

  it("supports refunds", () => {
    expect(reimbursableCents({ subtotalCents: -14500, taxCents: 0, feesCents: 0 , taxReimbursable: false, feesReimbursable: true})).toBe(-14500);
  });
});

describe("reimbursableCents with per-expense rules (R1.3)", () => {
  const receipt = { subtotalCents: 10_000, taxCents: 600, feesCents: 125 };

  it("is subtotal + fees under the original rule, unchanged", () => {
    // The default every existing row was migrated to: nothing historical may move.
    expect(
      reimbursableCents({ ...receipt, taxReimbursable: false, feesReimbursable: true }),
    ).toBe(10_125);
  });

  it("covers all four combinations", () => {
    const at = (taxReimbursable: boolean, feesReimbursable: boolean) =>
      reimbursableCents({ ...receipt, taxReimbursable, feesReimbursable });

    expect(at(false, false)).toBe(10_000); // subtotal only
    expect(at(false, true)).toBe(10_125); // + fees
    expect(at(true, false)).toBe(10_600); // + tax
    expect(at(true, true)).toBe(10_725); // the whole receipt
  });

  it("nets refunds correctly whichever parts are claimed (R1.4)", () => {
    // The real ClickUp -$145 case, with a negative tax alongside it.
    const refund = { subtotalCents: -14_500, taxCents: -870, feesCents: 0 };
    expect(reimbursableCents({ ...refund, taxReimbursable: false, feesReimbursable: true })).toBe(
      -14_500,
    );
    expect(reimbursableCents({ ...refund, taxReimbursable: true, feesReimbursable: true })).toBe(
      -15_370,
    );
  });

  it("never exceeds the receipt total", () => {
    const total = receiptTotalCents(receipt);
    for (const tax of [true, false]) {
      for (const fees of [true, false]) {
        expect(
          reimbursableCents({ ...receipt, taxReimbursable: tax, feesReimbursable: fees }),
        ).toBeLessThanOrEqual(total);
      }
    }
  });
});

describe("receiptTotalCents", () => {
  it("is always the whole receipt, whatever is claimed", () => {
    expect(receiptTotalCents({ subtotalCents: 10_000, taxCents: 600, feesCents: 125 })).toBe(10_725);
  });

  it("nets a refund", () => {
    expect(receiptTotalCents({ subtotalCents: -14_500, taxCents: 0, feesCents: 0 })).toBe(-14_500);
  });
});

describe("excludedParts", () => {
  const base = { subtotalCents: 10_000, taxCents: 600, feesCents: 125 };

  it("names only what is both present and unclaimed", () => {
    expect(excludedParts({ ...base, taxReimbursable: false, feesReimbursable: true })).toEqual([
      "tax",
    ]);
    expect(excludedParts({ ...base, taxReimbursable: true, feesReimbursable: false })).toEqual([
      "fees",
    ]);
    expect(excludedParts({ ...base, taxReimbursable: false, feesReimbursable: false })).toEqual([
      "tax",
      "fees",
    ]);
    expect(excludedParts({ ...base, taxReimbursable: true, feesReimbursable: true })).toEqual([]);
  });

  it("reports a refund's excluded tax, which still opens a gap (R1.4)", () => {
    // The credit note totals -$153.70 while the claim is -$145.00. Without the note the
    // cover sheet shows an $8.70 difference with nothing explaining it.
    expect(
      excludedParts({
        subtotalCents: -14_500,
        taxCents: -870,
        feesCents: 0,
        taxReimbursable: false,
        feesReimbursable: true,
      }),
    ).toEqual(["tax"]);
  });

  it("says nothing about a part that is zero", () => {
    // There is no gap to explain, so the cover sheet must stay silent — otherwise every
    // expense with no tax would carry a note about excluded tax it never had.
    expect(
      excludedParts({
        subtotalCents: 10_000,
        taxCents: 0,
        feesCents: 0,
        taxReimbursable: false,
        feesReimbursable: false,
      }),
    ).toEqual([]);
  });
});

describe("sanitiseMoneyInput", () => {
  it("drops letters and symbols", () => {
    expect(sanitiseMoneyInput("12abc")).toBe("12");
    expect(sanitiseMoneyInput("abc")).toBe("");
    expect(sanitiseMoneyInput("1e5")).toBe("15");
    expect(sanitiseMoneyInput("$1,234.56")).toBe("1,234.56");
    expect(sanitiseMoneyInput("145.00 USD")).toBe("145.00");
  });

  it("keeps every shape the parser accepts", () => {
    // If any of these were stripped, real entry would break — so assert the round trip,
    // not just the surviving text.
    for (const raw of ["1,234.56", "$1,234.56", "-145.00", "(145.00)", "0.5", "1234"]) {
      const clean = sanitiseMoneyInput(raw);
      expect(parseMoneyToCents(clean)).toBe(parseMoneyToCents(raw));
      expect(parseMoneyToCents(clean)).not.toBeNull();
    }
  });

  it("leaves a half-typed value alone", () => {
    // These are all invalid numbers, and all of them are what the field holds mid-keystroke.
    for (const partial of ["", "-", "12.", ".", ".5", "(", "(1"]) {
      expect(sanitiseMoneyInput(partial)).toBe(partial);
    }
  });

  it("keeps only the first decimal point", () => {
    // "12.5.3" parses to null, which `parseMoneyToCentsOrZero` would turn into $0.00.
    expect(sanitiseMoneyInput("12.5.3")).toBe("12.53");
  });

  it("only lets a sign lead", () => {
    expect(sanitiseMoneyInput("1-2")).toBe("12");
    expect(sanitiseMoneyInput("1(2)")).toBe("12");
    expect(sanitiseMoneyInput("145.00)")).toBe("145.00");
  });

  it("is a prefix-stable fold, so the caret can be restored by sanitising the prefix", () => {
    // MoneyInput relies on this to avoid flinging the caret to the end mid-edit.
    for (const raw of ["1a2.b3", "$1,234.56", "-1.2.3", "(1a)"]) {
      const full = sanitiseMoneyInput(raw);
      for (let i = 0; i <= raw.length; i += 1) {
        expect(full.startsWith(sanitiseMoneyInput(raw.slice(0, i)))).toBe(true);
      }
    }
  });
});
