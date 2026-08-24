import { describe, expect, it } from "vitest";

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
  lineItemId: "11111111-1111-1111-1111-111111111111",
  paymentSource: "Paid by us, reimbursement requested",
  month: "2026-02",
  date: "2026-02-15",
  description: "Test",
  subtotal: "100.00",
  tax: "",
  fees: "",
  note: "",
  narrative: "",
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
