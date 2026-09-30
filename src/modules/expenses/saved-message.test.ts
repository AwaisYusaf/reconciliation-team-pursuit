import { describe, expect, it } from "vitest";

import { savedMessage } from "./saved-message";

/**
 * The toast after an expense is saved (usability #30): it names every documentation gap the
 * gate will still hold the expense for, counted from what it will have once its queued files
 * upload. `savedMessage` is the pure helper the form calls; the form's own wiring is pinned in
 * `expense-form-wiring.test.ts`.
 */
const NOTHING = { noReceipt: false, attached: [], queued: [], invoiceIsReceipt: false } as const;

describe("savedMessage (usability #30)", () => {
  it("E13: nothing attached or queued names both gaps, never the R4.4 word 'both'", () => {
    const message = savedMessage(NOTHING);
    expect(message).toBe("Expense saved. It's still missing proof of payment and a receipt.");
    expect(message).not.toMatch(/\bboth\b/);
  });

  it("E14: proof queued only still needs a receipt", () => {
    expect(savedMessage({ ...NOTHING, queued: [{ scope: "proof" }] })).toBe(
      "Expense saved. It's still missing a receipt.",
    );
  });

  it("E15: receipt queued only still needs proof of payment", () => {
    expect(savedMessage({ ...NOTHING, queued: [{ scope: "receipt" }] })).toBe(
      "Expense saved. It's still missing proof of payment.",
    );
  });

  it("E16: no receipt available plus queued proof is complete", () => {
    expect(savedMessage({ ...NOTHING, noReceipt: true, queued: [{ scope: "proof" }] })).toBe("Expense saved.");
  });

  it("proof and receipt both queued is complete", () => {
    expect(savedMessage({ ...NOTHING, queued: [{ scope: "proof" }, { scope: "receipt" }] })).toBe(
      "Expense saved.",
    );
  });

  it("already-attached files count on an edit", () => {
    expect(
      savedMessage({
        ...NOTHING,
        attached: [
          { kind: "proof", status: "attached" },
          { kind: "receipt", status: "attached" },
        ],
      }),
    ).toBe("Expense saved.");
  });

  it("E17: an attached proof whose upload failed does not count (R4.6)", () => {
    expect(
      savedMessage({
        ...NOTHING,
        attached: [{ kind: "proof", status: "failed" }],
        queued: [{ scope: "receipt" }],
      }),
    ).toBe("Expense saved. It's still missing proof of payment.");
  });

  it("a pending proof does not count either", () => {
    expect(
      savedMessage({ ...NOTHING, attached: [{ kind: "proof", status: "pending" }], queued: [{ scope: "receipt" }] }),
    ).toBe("Expense saved. It's still missing proof of payment.");
  });

  it("E18: a supporting file is neither proof nor receipt", () => {
    expect(savedMessage({ ...NOTHING, queued: [{ scope: "supporting" }] })).toBe(
      "Expense saved. It's still missing proof of payment and a receipt.",
    );
  });

  it("E19: an invoice card's invoice is the receipt, so only proof is missing", () => {
    expect(savedMessage({ ...NOTHING, invoiceIsReceipt: true })).toBe(
      "Expense saved. It's still missing proof of payment.",
    );
  });

  it("E19 with proof queued on the card is complete", () => {
    expect(savedMessage({ ...NOTHING, invoiceIsReceipt: true, queued: [{ scope: "proof" }] })).toBe(
      "Expense saved.",
    );
  });

  it("never asks about the narrative: a save without one is refused before this runs (R4.7)", () => {
    expect(savedMessage(NOTHING)).not.toContain("narrative");
  });
});
