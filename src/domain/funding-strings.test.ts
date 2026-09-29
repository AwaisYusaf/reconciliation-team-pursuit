/**
 * The funding limit and onboarding copy (R9.6, m00, m07, m08), pinned verbatim: each expected
 * string is written out, not rebuilt from the function under test, so a wording change fails here.
 */
import { describe, expect, it } from "vitest";

import { lineItemsAgainstTotal, UI } from "./strings";

describe("lineItemsAgainstTotal (#46, #37)", () => {
  it("over the contract total", () => {
    expect(lineItemsAgainstTotal(16_000_001, 15_000_000)).toBe(
      "Line items total $160,000.01, $10,000.01 more than the $150,000.00 contract total. Lower a line item, or raise the contract value in Settings.",
    );
  });

  it("under the contract total", () => {
    expect(lineItemsAgainstTotal(10_000_000, 15_000_000)).toBe(
      "Line items total $100,000.00 of the $150,000.00 contract total. $50,000.00 is not in a line item yet.",
    );
  });

  it("exactly the contract total", () => {
    expect(lineItemsAgainstTotal(15_000_000, 15_000_000)).toBe(
      "Line items total $150,000.00, the full contract total.",
    );
  });
});

describe("onboarding copy (m00)", () => {
  it("onboardingRules names all four tax/fee combinations and where to change them", () => {
    const tail = " You can change this later in Settings, under Funding sources.";
    expect(UI.onboardingRules(true, true)).toBe(`By default, this funding reimburses sales tax and fees.${tail}`);
    expect(UI.onboardingRules(true, false)).toBe(`By default, this funding reimburses sales tax but not fees.${tail}`);
    expect(UI.onboardingRules(false, true)).toBe(`By default, this funding reimburses fees but not sales tax.${tail}`);
    expect(UI.onboardingRules(false, false)).toBe(`By default, this funding doesn't reimburse sales tax or fees.${tail}`);
  });

  it("onboardingPlanned reads left or over", () => {
    expect(UI.onboardingPlanned("$100.00", "$150.00", "$50.00", false)).toBe("Planned $100.00 of $150.00 · $50.00 left");
    expect(UI.onboardingPlanned("$200.00", "$150.00", "$50.00", true)).toBe("Planned $200.00 of $150.00 · $50.00 over");
  });

  it("onboardingOverTotal", () => {
    expect(UI.onboardingOverTotal("$200,000.00", "$150,000.00")).toBe(
      "These line items add up to $200,000.00, more than your total of $150,000.00. Lower a line item, or go back and change the total amount.",
    );
  });
});

describe("funding limit refusals (R9.6)", () => {
  it("fundingLimitExceeded", () => {
    expect(UI.fundingLimitExceeded("$150,000.01", "$150,000.00")).toBe(
      "These line items would add up to $150,000.01, more than the $150,000.00 contract total. Lower a line item, or raise the contract value in Settings.",
    );
  });

  it("contractValueBelowLineItems", () => {
    expect(UI.contractValueBelowLineItems("$150,000.00", "$149,999.99")).toBe(
      "The line items add up to $150,000.00, more than the $149,999.99 contract total this would give. Lower a line item first, or enter a larger contract value.",
    );
  });
});
