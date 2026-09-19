/**
 * Phase 10 UI copy — every entry checked verbatim against Appendix A (`docs/PHASE-10.md`), and
 * the panel's summary-line helpers cross-checked against the worked example in §2/Appendix A §1.
 */
import { describe, expect, it } from "vitest";

import { amountFigures, UI } from "./strings";

describe("Phase 10 UI copy — verbatim against Appendix A", () => {
  it("static entries", () => {
    expect(UI.amountsFoundTitle).toBe("Amounts found in your documents");
    expect(UI.noAmountFound).toBe("No amount found");
    expect(UI.useTheseAmounts).toBe("Use these amounts");
    expect(UI.dismiss).toBe("Dismiss");
    expect(UI.replaceTypedAmounts).toBe("Replace the amounts you typed?");
    expect(UI.readAmountsFromDocuments).toBe("Read amounts from documents");
    expect(UI.readAmountsSwitchLabel).toBe("Read amounts from uploaded documents");
    expect(UI.readAmountsSwitchHelp).toBe(
      "Receipts and proofs of payment are sent to OpenAI to suggest amounts. OpenAI doesn't use them for training. Nothing is saved until you confirm.",
    );
    expect(UI.receiptDoesNotAddUp).toBe("The amounts on this receipt don't add up. Check them before saving.");
    expect(UI.proofOfPaymentTag).toBe("(proof of payment)");
    expect(UI.proofMatches).toBe("✓ matches");
    expect(UI.cancel).toBe("Cancel");
    expect(UI.tourAmountsBody).toBe(
      "Enter the amounts from the receipt. If it includes tax or fees, you'll be asked whether the funder pays for them.",
    );
    expect(UI.tourAmountsBodyWithReading).toBe(
      "Enter the amounts from the receipt, or use the ones AI finds in the receipt you added above. If it includes tax or fees, you'll be asked whether the funder pays for them.",
    );
  });

  it("readingDocuments pluralizes only at exactly 1", () => {
    expect(UI.readingDocuments(1)).toBe("Reading 1 document…");
    expect(UI.readingDocuments(2)).toBe("Reading 2 documents…");
    expect(UI.readingDocuments(0)).toBe("Reading 0 documents…");
  });

  it("proofsDifferWarning matches the Appendix A sentence exactly, figures substituted", () => {
    expect(UI.proofsDifferWarning("$165.00", "$170.00")).toBe(
      "Receipts add up to $165.00 but proofs of payment show $170.00. Check the amounts before saving.",
    );
  });

  it("amountsLeftOut (Phase 10 §3.5 table addition, not in Appendix A)", () => {
    expect(UI.amountsLeftOut).toBe(
      "Documents marked No amount found are left out of these totals.",
    );
  });

  it("amountsSummary for the worked example: Subtotal $150.00 · Tax $9.00 · Fees $6.00 · Total paid $165.00", () => {
    const amounts = { subtotalCents: 15000, taxCents: 900, feesCents: 600, totalCents: 16500 };
    expect(UI.amountsSummary(amounts)).toBe("Subtotal $150.00 · Tax $9.00 · Fees $6.00 · Total paid $165.00");
  });

  it("receiptLineAmounts for one receipt's line: Subtotal $110.00 · Tax $6.60 · Fees $3.40 · Total $120.00", () => {
    const amounts = { subtotalCents: 11000, taxCents: 660, feesCents: 340, totalCents: 12000 };
    expect(UI.receiptLineAmounts(amounts)).toBe("Subtotal $110.00 · Tax $6.60 · Fees $3.40 · Total $120.00");
  });

  it("amountFigures carries the same words and figures as amountsSummary, total last", () => {
    const amounts = { subtotalCents: 15000, taxCents: 900, feesCents: 600, totalCents: 16500 };
    const figures = amountFigures(amounts);
    expect(figures.map((f) => `${f.label} ${f.value}`).join(" · ")).toBe(UI.amountsSummary(amounts));
    expect(figures.map((f) => f.total)).toEqual([false, false, false, true]);
    expect(figures[3]).toMatchObject({ label: "Total paid", value: "$165.00" });
  });
});

describe("a refund's total (PR #18 round 3, #7)", () => {
  const refund = { subtotalCents: -14500, taxCents: 0, feesCents: 0, totalCents: -14500 };

  it("reads 'Total refunded $145.00', never 'Total paid -$145.00'", () => {
    expect(UI.amountsSummary(refund)).toContain("Total refunded $145.00");
    expect(UI.amountsSummary(refund)).not.toContain("Total paid");
    expect(amountFigures(refund)[3]).toMatchObject({ label: "Total refunded", value: "$145.00", total: true });
  });

  it("a payment, and a zero total, still read 'Total paid'", () => {
    expect(amountFigures({ ...refund, subtotalCents: 16500, totalCents: 16500 })[3]).toMatchObject({ label: "Total paid", value: "$165.00" });
    expect(amountFigures({ ...refund, subtotalCents: 0, totalCents: 0 })[3]).toMatchObject({ label: "Total paid", value: "$0.00" });
  });
});
