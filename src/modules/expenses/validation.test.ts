import { describe, expect, it } from "vitest";

import { UI } from "@/src/domain/strings";

import type { ExpenseInput } from "./actions";
import { validate } from "./validation";

/**
 * `validate` is the rule shared by create and update — a pure function, so these exercise it
 * directly rather than through the DB-backed server actions.
 *
 * Covers the money-field gap found in review (C-11): a blank subtotal/tax/fees field means
 * zero and must stay accepted, but a field with something unparseable in it — stray text, a
 * stray character — must be rejected rather than silently saved as zero.
 */
const BASE: ExpenseInput = {
  name: "Test Vendor",
  fundingSourceId: "22222222-2222-2222-2222-222222222222",
  lineItemId: "11111111-1111-1111-1111-111111111111",
  paymentSource: "Paid by us, reimbursement requested",
  taxReimbursable: false,
  feesReimbursable: true,
  month: "2026-02",
  date: "2026-02-15",
  description: "Test",
  subtotal: "100.00",
  tax: "",
  fees: "",
  note: "",
  narrative: "Consulting services rendered in February.",
  noReceipt: false,
  noReceiptReason: "",
};

describe("validate — money fields", () => {
  it("accepts a well-formed subtotal", () => {
    expect(validate(BASE)).toBeNull();
  });

  it("accepts a blank subtotal, tax, and fees as zero, not an error", () => {
    expect(validate({ ...BASE, subtotal: "", tax: "", fees: "" })).toBeNull();
  });

  it("accepts a comma-formatted subtotal (1,253.75)", () => {
    expect(validate({ ...BASE, subtotal: "1,253.75" })).toBeNull();
  });

  it("rejects a subtotal with a stray non-numeric character instead of silently reading it as zero", () => {
    expect(validate({ ...BASE, subtotal: "12a3.45" })).toBe("Enter a valid subtotal, like 1234.56.");
  });

  it("rejects a tax field with a stray character", () => {
    expect(validate({ ...BASE, tax: "1x2" })).toBe("Enter a valid tax amount, like 12.34.");
  });

  it("rejects a fees field with a stray character", () => {
    expect(validate({ ...BASE, fees: "$$" })).toBe("Enter a valid fees amount, like 12.34.");
  });

  it("still accepts a negative subtotal — refunds are a documented, intended use (R1.4)", () => {
    expect(validate({ ...BASE, subtotal: "-50" })).toBeNull();
  });

  it("still accepts a zero subtotal", () => {
    expect(validate({ ...BASE, subtotal: "0" })).toBeNull();
  });
});

describe("validate — narrative (R4.7)", () => {
  it("rejects an empty narrative", () => {
    expect(validate({ ...BASE, narrative: "" })).toBe("Enter a narrative for this expense.");
  });

  it("rejects a whitespace-only narrative", () => {
    expect(validate({ ...BASE, narrative: "   " })).toBe("Enter a narrative for this expense.");
  });

  it("accepts a real narrative", () => {
    expect(validate({ ...BASE, narrative: "Monthly consulting retainer." })).toBeNull();
  });

  it("applies the same rule to an update as to a create — validate() is shared", () => {
    expect(validate({ ...BASE, id: "some-id", narrative: "" })).toBe(
      "Enter a narrative for this expense.",
    );
  });
});

describe("validate — draft mode (Phase 14, D-115)", () => {
  it("lets a draft leave the line item and the narrative blank", () => {
    expect(validate({ ...BASE, lineItemId: "", narrative: "" }, { draft: true })).toBeNull();
  });

  it("still refuses those two on a live save, so the relaxation cannot leak", () => {
    // The whole risk of adding an options argument is that a live caller silently gets the
    // weaker rules. Both live callers in actions.ts pass no options, which is this case.
    expect(validate({ ...BASE, lineItemId: "" })).toBe(UI.expenseMissingFields);
    expect(validate({ ...BASE, narrative: "" })).toBe(UI.expenseMissingNarrative);
    expect(validate({ ...BASE, lineItemId: "", narrative: "" }, {})).toBe(UI.expenseMissingFields);
    expect(validate({ ...BASE, lineItemId: "", narrative: "" }, { draft: false })).toBe(
      UI.expenseMissingFields,
    );
  });

  it("relaxes only those two: every other rule still applies to a draft", () => {
    expect(validate({ ...BASE, name: "   " }, { draft: true })).toBe(UI.expenseMissingFields);
    expect(validate({ ...BASE, paymentSource: "" }, { draft: true })).toBe(UI.expenseMissingFields);
    expect(validate({ ...BASE, fundingSourceId: "not-a-uuid" }, { draft: true })).toBe(
      "Choose a funding source.",
    );
    expect(validate({ ...BASE, month: "2026-13" }, { draft: true })).toBe("Choose a month.");
    expect(validate({ ...BASE, date: "2026-02-30" }, { draft: true })).toBe("Enter a valid date.");
    expect(validate({ ...BASE, subtotal: "not money" }, { draft: true })).toBe(
      "Enter a valid subtotal, like 1234.56.",
    );
    expect(validate({ ...BASE, noReceipt: true, noReceiptReason: "" }, { draft: true })).toBe(
      UI.noReceiptReasonRequired,
    );
  });
});
