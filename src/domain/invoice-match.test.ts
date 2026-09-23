import { describe, expect, it } from "vitest";

import {
  matchInvoiceLine,
  type InvoiceLine,
  type MatchContext,
  type RecurringMatch,
  type VendorMatch,
} from "./invoice-match";

function line(overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    name: "Adobe",
    description: "Design software",
    amountCents: 4999,
    taxCents: null,
    feesCents: null,
    ...overrides,
  };
}

function recurring(overrides: Partial<RecurringMatch> = {}): RecurringMatch {
  return {
    name: "Adobe",
    lineItemId: "software",
    defaultDescription: "Design tools",
    defaultNarrative: "Monthly design subscription",
    defaultPaymentSource: "Amex",
    defaultTaxCents: 100,
    defaultFeesCents: 50,
    ...overrides,
  };
}

function vendor(overrides: Partial<VendorMatch> = {}): VendorMatch {
  return {
    name: "Adobe",
    defaultLineItemId: "software",
    defaultDescription: "Vendor default description",
    defaultPaymentSource: "Amex",
    ...overrides,
  };
}

function ctx(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    recurringItems: [],
    vendors: [],
    activePaymentSources: ["Amex", "Visa"],
    sourceLineItemIds: ["software"],
    invoiceDate: "2026-09-15",
    month: "2026-09",
    ...overrides,
  };
}

describe("matchInvoiceLine", () => {
  it("prefers a recurring match over a vendor default for the same name, and carries its narrative", () => {
    const result = matchInvoiceLine(
      line(),
      ctx({ recurringItems: [recurring()], vendors: [vendor({ defaultDescription: "Vendor wins?" })] }),
    );

    expect(result.lineItemId).toBe("software");
    expect(result.description).toBe("Design tools");
    expect(result.narrative).toBe("Monthly design subscription");
  });

  it("matches case-insensitively and ignores surrounding whitespace on either side", () => {
    const result = matchInvoiceLine(
      line({ name: "  ADOBE  " }),
      ctx({ recurringItems: [recurring({ name: "adobe" })] }),
    );

    expect(result.narrative).toBe("Monthly design subscription");
    expect(result.name).toBe("ADOBE");
  });

  it("does not let a recurring default override tax/fees the invoice line actually printed, including a zero beating a remembered non-zero", () => {
    const result = matchInvoiceLine(
      line({ taxCents: 0, feesCents: 0 }),
      ctx({ recurringItems: [recurring({ defaultTaxCents: 500, defaultFeesCents: 250 })] }),
    );

    expect(result.taxCents).toBe(0);
    expect(result.feesCents).toBe(0);
  });

  it("fills tax/fees from the recurring default when the line printed none, and turns a null default into 0", () => {
    const filled = matchInvoiceLine(
      line({ taxCents: null, feesCents: null }),
      ctx({ recurringItems: [recurring({ defaultTaxCents: 300, defaultFeesCents: 150 })] }),
    );
    expect(filled.taxCents).toBe(300);
    expect(filled.feesCents).toBe(150);

    const nullDefaults = matchInvoiceLine(
      line({ taxCents: null, feesCents: null }),
      ctx({ recurringItems: [recurring({ defaultTaxCents: null, defaultFeesCents: null })] }),
    );
    expect(nullDefaults.taxCents).toBe(0);
    expect(nullDefaults.feesCents).toBe(0);
  });

  it("leaves an unmatched line with an empty line item, no narrative, the org's usual payment source, and the line's own description", () => {
    const result = matchInvoiceLine(
      line({ name: "Unknown Vendor", description: "Whatever it printed" }),
      ctx(),
    );

    expect(result.lineItemId).toBeNull();
    expect(result.narrative).toBeNull();
    expect(result.paymentSource).toBe("Amex");
    expect(result.description).toBe("Whatever it printed");
  });

  it("drops a matched line item belonging to a different funding source instead of falling through to another tier", () => {
    const result = matchInvoiceLine(
      line(),
      ctx({
        recurringItems: [recurring({ lineItemId: "other-source-item" })],
        sourceLineItemIds: ["software"],
      }),
    );

    expect(result.lineItemId).toBeNull();
    // Still the recurring tier's other fields — a dropped line item does not demote to vendor/unmatched.
    expect(result.narrative).toBe("Monthly design subscription");
  });

  it("drops a retired payment label and falls back to the org's usual active label", () => {
    const result = matchInvoiceLine(
      line(),
      ctx({
        recurringItems: [recurring({ defaultPaymentSource: "Retired Card" })],
        activePaymentSources: ["Amex", "Visa"],
      }),
    );

    expect(result.paymentSource).toBe("Amex");
  });

  it("never supplies a narrative from a vendor match", () => {
    const result = matchInvoiceLine(line(), ctx({ vendors: [vendor()] }));
    expect(result.narrative).toBeNull();
  });

  it("treats an empty or whitespace-only line name as matching nothing, even against a blank-named remembered row, and stores the name trimmed", () => {
    const blankRecurring = recurring({ name: "  " });
    const blankVendor = vendor({ name: "" });

    const empty = matchInvoiceLine(
      line({ name: "   " }),
      ctx({ recurringItems: [blankRecurring], vendors: [blankVendor] }),
    );

    expect(empty.lineItemId).toBeNull();
    expect(empty.narrative).toBeNull();
    expect(empty.name).toBe("");

    const trimmed = matchInvoiceLine(line({ name: "  Adobe  " }), ctx());
    expect(trimmed.name).toBe("Adobe");
  });

  it("lands a $0.00 amount and a null amount both as 0 cents", () => {
    const zero = matchInvoiceLine(line({ amountCents: 0 }), ctx());
    expect(zero.subtotalCents).toBe(0);

    const missing = matchInvoiceLine(line({ amountCents: null }), ctx());
    expect(missing.subtotalCents).toBe(0);
  });

  it("passes a negative refund amount through unchanged", () => {
    const result = matchInvoiceLine(line({ amountCents: -1500 }), ctx());
    expect(result.subtotalCents).toBe(-1500);
  });

  it("falls back to an empty payment source string when the org has no active sources at all", () => {
    const result = matchInvoiceLine(line({ name: "Unknown" }), ctx({ activePaymentSources: [] }));
    expect(result.paymentSource).toBe("");
  });

  it("picks the first entry when the ctx lists carry duplicate names", () => {
    const recurringResult = matchInvoiceLine(
      line(),
      ctx({
        recurringItems: [
          recurring({ defaultDescription: "First one" }),
          recurring({ defaultDescription: "Second one" }),
        ],
      }),
    );
    expect(recurringResult.description).toBe("First one");

    const vendorResult = matchInvoiceLine(
      line({ name: "Vendor Co" }),
      ctx({
        vendors: [
          vendor({ name: "Vendor Co", defaultDescription: "First vendor" }),
          vendor({ name: "Vendor Co", defaultDescription: "Second vendor" }),
        ],
      }),
    );
    expect(vendorResult.description).toBe("First vendor");
  });

  it("falls back to the line's own description when the matched row remembers none, and to empty when neither has one", () => {
    const fromRecurring = matchInvoiceLine(
      line({ description: "What the bill printed" }),
      ctx({ recurringItems: [recurring({ defaultDescription: "" })] }),
    );
    expect(fromRecurring.description).toBe("What the bill printed");

    const fromVendor = matchInvoiceLine(
      line({ description: "What the bill printed" }),
      ctx({ vendors: [vendor({ defaultDescription: "" })] }),
    );
    expect(fromVendor.description).toBe("What the bill printed");

    // A recurring row's description is nullable in the schema; null must behave as "remembers none".
    const nullRemembered = matchInvoiceLine(
      line({ description: "What the bill printed" }),
      ctx({ recurringItems: [recurring({ defaultDescription: null })] }),
    );
    expect(nullRemembered.description).toBe("What the bill printed");

    // Neither side has one: the column is NOT NULL, so it has to be the empty string.
    const neither = matchInvoiceLine(line({ description: null }), ctx());
    expect(neither.description).toBe("");
  });

  it("carries month and date straight from ctx", () => {
    const result = matchInvoiceLine(line(), ctx({ month: "2027-01", invoiceDate: "2027-01-05" }));
    expect(result.month).toBe("2027-01");
    expect(result.date).toBe("2027-01-05");
  });
});
