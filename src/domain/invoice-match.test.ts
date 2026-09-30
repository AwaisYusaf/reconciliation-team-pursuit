import { describe, expect, it } from "vitest";

import {
  matchInvoiceLine,
  withInvoiceVendor,
  withoutInvoiceVendors,
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
    vendor: null,
    earlierVendors: [],
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

/**
 * The invoice's vendor in each charge's description (usability #62), so the cover sheet's Role
 * column says who was paid. The name stays the line's own: matching keys on it (PHASE-14 §5).
 */
describe("withInvoiceVendor", () => {
  it("puts the vendor in front of the line's description (E53)", () => {
    expect(withInvoiceVendor("Dinner", "Eastside Catering", "Dinner for 40", [])).toBe("Eastside Catering: Dinner");
  });

  it("is the vendor alone when the description is empty or blank (E54)", () => {
    expect(withInvoiceVendor("", "Eastside Catering", "Dinner", [])).toBe("Eastside Catering");
    expect(withInvoiceVendor("   ", "Eastside Catering", "Dinner", [])).toBe("Eastside Catering");
  });

  it("leaves a description that already names the vendor, in any case (E55)", () => {
    expect(withInvoiceVendor("Catering by eastside catering", "Eastside Catering", "Dinner", [])).toBe(
      "Catering by eastside catering",
    );
  });

  it("leaves the description when the invoice named no vendor, or a blank one (E56)", () => {
    expect(withInvoiceVendor("Dinner", null, "Dinner", [])).toBe("Dinner");
    expect(withInvoiceVendor("Dinner", "   ", "Dinner", [])).toBe("Dinner");
    expect(withInvoiceVendor("", null, "Dinner", [])).toBe("");
  });

  it("leaves the description when the line's name already is the vendor, ignoring case and spaces (E57)", () => {
    expect(withInvoiceVendor("Monthly plan", "Adobe", " adobe ", [])).toBe("Monthly plan");
  });

  it("trims the vendor it adds and the description it keeps", () => {
    expect(withInvoiceVendor("  Dinner  ", "  Eastside Catering ", "Food", [])).toBe("Eastside Catering: Dinner");
  });

  it("swaps an earlier invoice's vendor for this one, never stacking them (review: second import)", () => {
    const earlier = ["Eastside Catering"];
    expect(withInvoiceVendor("Eastside Catering: Box lunches", "Westside Deli", "Box lunches", earlier)).toBe(
      "Westside Deli: Box lunches",
    );
    // Any case, and a description that was only the earlier vendor (a line with none of its own).
    expect(withInvoiceVendor("EASTSIDE CATERING: Box lunches", "Westside Deli", "Box lunches", earlier)).toBe(
      "Westside Deli: Box lunches",
    );
    expect(withInvoiceVendor("Eastside Catering", "Westside Deli", "Box lunches", earlier)).toBe("Westside Deli");
  });

  it("drops only a leading 'vendor: ', never the vendor named inside the text or a shorter name", () => {
    expect(
      withInvoiceVendor("Lunches, same as Eastside Catering", "Westside Deli", "Box lunches", ["Eastside Catering"]),
    ).toBe("Westside Deli: Lunches, same as Eastside Catering");
    expect(withInvoiceVendor("Eastside: office", "Westside Deli", "Rent", ["Eastside Catering"])).toBe(
      "Westside Deli: Eastside: office",
    );
    // A blank entry in the list strips nothing.
    expect(withInvoiceVendor("Box lunches", "Westside Deli", "Box lunches", ["  "])).toBe("Westside Deli: Box lunches");
  });

  it("strips the other vendor before checking whether this one is already named (review: Uber vs Uber Eats)", () => {
    // "Uber" is inside "Uber Eats", but that was another vendor's prefix, not this one's name.
    expect(withInvoiceVendor("Uber Eats: Team lunch", "Uber", "Team lunch", ["Uber Eats"])).toBe("Uber: Team lunch");
    expect(withInvoiceVendor("Eastside Catering: Box lunches", "Eastside", "Box lunches", ["Eastside Catering"])).toBe(
      "Eastside: Box lunches",
    );
  });

  it("strips an earlier vendor even when the line's name is this invoice's vendor", () => {
    expect(withInvoiceVendor("Eastside Catering: Monthly plan", "Adobe", "Adobe", ["Eastside Catering"])).toBe(
      "Monthly plan",
    );
  });

  it("strips 'Vendor:' with or without a space, and repeated prefixes left by older imports", () => {
    expect(withInvoiceVendor("Eastside Catering:Box lunches", "Westside Deli", "Box lunches", ["Eastside Catering"])).toBe(
      "Westside Deli: Box lunches",
    );
    expect(
      withInvoiceVendor("Northside Deli: Eastside Catering: Box lunches", "Westside Deli", "Box lunches", [
        "Eastside Catering",
        "Northside Deli",
      ]),
    ).toBe("Westside Deli: Box lunches");
  });

  it("keeps this vendor's own prefix from an earlier invoice as it is (same vendor twice)", () => {
    expect(
      withInvoiceVendor("Eastside Catering: Box lunches", "Eastside Catering", "Box lunches", ["Eastside Catering"]),
    ).toBe("Eastside Catering: Box lunches");
    // Even when the line's name is that vendor: only another vendor's prefix is dropped.
    expect(withInvoiceVendor("Adobe: Monthly plan", "Adobe", "Adobe", ["Adobe"])).toBe("Adobe: Monthly plan");
  });
});

/** What the vendor library learns (`learnVendor`), and the strip `withInvoiceVendor` uses. */
describe("withoutInvoiceVendors", () => {
  it("drops a leading invoice vendor, in any case, with or without a space after the colon", () => {
    expect(withoutInvoiceVendors("Eastside Catering: Box lunches", ["Eastside Catering"])).toBe("Box lunches");
    expect(withoutInvoiceVendors("eastside catering:Box lunches", ["Eastside Catering"])).toBe("Box lunches");
  });

  it("is empty when the text is only an invoice vendor, and unchanged without one", () => {
    expect(withoutInvoiceVendors("Eastside Catering", ["Eastside Catering"])).toBe("");
    expect(withoutInvoiceVendors("Box lunches", ["Eastside Catering"])).toBe("Box lunches");
    expect(withoutInvoiceVendors("Box lunches", [])).toBe("Box lunches");
  });

  it("leaves a vendor named later in the text, and a name that only starts the same way", () => {
    expect(withoutInvoiceVendors("Lunch from Eastside Catering", ["Eastside Catering"])).toBe(
      "Lunch from Eastside Catering",
    );
    expect(withoutInvoiceVendors("Eastside Cateringco: x", ["Eastside Catering"])).toBe("Eastside Cateringco: x");
  });
});

describe("matchInvoiceLine: every tier carries the invoice's vendor (E58)", () => {
  it("prefixes the recurring tier's remembered description", () => {
    const result = matchInvoiceLine(line(), ctx({ recurringItems: [recurring()], vendor: "Adobe Inc." }));
    expect(result.narrative).toBe("Monthly design subscription"); // proves the recurring tier ran
    expect(result.description).toBe("Adobe Inc.: Design tools");
    expect(result.name).toBe("Adobe");
  });

  it("prefixes the vendor-library tier's remembered description", () => {
    const result = matchInvoiceLine(line(), ctx({ vendors: [vendor()], vendor: "Adobe Inc." }));
    expect(result.lineItemId).toBe("software"); // proves the vendor tier ran
    expect(result.narrative).toBeNull();
    expect(result.description).toBe("Adobe Inc.: Vendor default description");
  });

  it("prefixes an unmatched line's own description", () => {
    const result = matchInvoiceLine(
      line({ name: "Dinner for 40", description: "Dinner" }),
      ctx({ vendor: "Eastside Catering" }),
    );
    expect(result.lineItemId).toBeNull(); // proves nothing matched
    expect(result.description).toBe("Eastside Catering: Dinner");
    expect(result.name).toBe("Dinner for 40");
  });

  it("gives an unmatched line with no description the vendor alone", () => {
    const result = matchInvoiceLine(line({ name: "Dinner", description: null }), ctx({ vendor: "Eastside Catering" }));
    expect(result.description).toBe("Eastside Catering");
  });

  it("replaces an earlier invoice's vendor the library learned, in every tier (review: second import)", () => {
    const learned = "Eastside Catering: Box lunches";
    const earlierVendors = ["Eastside Catering"];
    const fromVendor = matchInvoiceLine(
      line({ name: "Box lunches" }),
      ctx({
        vendors: [vendor({ name: "Box lunches", defaultDescription: learned })],
        vendor: "Westside Deli",
        earlierVendors,
      }),
    );
    expect(fromVendor.lineItemId).toBe("software"); // proves the vendor tier ran
    expect(fromVendor.description).toBe("Westside Deli: Box lunches");

    const fromRecurring = matchInvoiceLine(
      line({ name: "Box lunches" }),
      ctx({
        recurringItems: [recurring({ name: "Box lunches", defaultDescription: learned })],
        vendor: "Westside Deli",
        earlierVendors,
      }),
    );
    expect(fromRecurring.narrative).toBe("Monthly design subscription"); // proves the recurring tier ran
    expect(fromRecurring.description).toBe("Westside Deli: Box lunches");

    const unmatched = matchInvoiceLine(
      line({ name: "Box lunches", description: learned }),
      ctx({ vendor: "Westside Deli", earlierVendors }),
    );
    expect(unmatched.lineItemId).toBeNull(); // proves nothing matched
    expect(unmatched.description).toBe("Westside Deli: Box lunches");
  });

  it("changes nothing when the line's name is the vendor (a matched recurring item named for it)", () => {
    const result = matchInvoiceLine(line(), ctx({ recurringItems: [recurring()], vendor: "ADOBE" }));
    expect(result.description).toBe("Design tools");
  });
});
