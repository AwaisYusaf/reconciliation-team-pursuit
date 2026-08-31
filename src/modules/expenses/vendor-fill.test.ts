import { describe, expect, it } from "vitest";

import type { ExpenseInput } from "./actions";
import { fillFromClick, fillFromTypedName, moneyField, type VendorFill } from "./vendor-fill";

const BLANK: ExpenseInput = {
  name: "",
  lineItemId: "",
  paymentSource: "",
  taxReimbursable: false,
  feesReimbursable: true,
  month: "2026-02",
  date: "2026-02-10",
  description: "",
  subtotal: "",
  tax: "",
  fees: "",
  note: "",
  narrative: "",
  noReceipt: false,
  noReceiptReason: "",
};

const ACTIVE_SOURCES = ["Paid by us, reimbursement requested", "Paid directly by fiduciary"];

const CANVA: VendorFill = {
  name: "Canva",
  lineItemId: "line-promo",
  description: "Design tool for canvassing materials",
  paymentSource: "Paid by us, reimbursement requested",
  subtotalCents: 4500,
  taxCents: 250,
  feesCents: 125,
};

describe("moneyField", () => {
  it("renders a remembered zero rather than treating it as absent", () => {
    // A vendor that genuinely charges no tax is worth remembering; only null means unknown.
    expect(moneyField(0)).toBe("0.00");
    expect(moneyField(null)).toBe("");
  });

  it("renders cents as a plain editable amount, with no currency symbol", () => {
    // It goes straight into a money input, which draws its own "$".
    expect(moneyField(4500)).toBe("45.00");
    expect(moneyField(7)).toBe("0.07");
    expect(moneyField(123456)).toBe("1234.56");
  });
});

describe("fillFromTypedName", () => {
  it("fills an untouched form", () => {
    const result = fillFromTypedName(BLANK, CANVA);
    expect(result.lineItemId).toBe("line-promo");
    expect(result.description).toBe(CANVA.description);
    expect(result.subtotal).toBe("45.00");
    expect(result.tax).toBe("2.50");
    expect(result.fees).toBe("1.25");
  });

  it("leaves the form completely alone once a line item has been chosen", () => {
    // This fires from ordinary typing, so it must never take away a deliberate choice.
    const chosen = { ...BLANK, lineItemId: "line-salary" };
    expect(fillFromTypedName(chosen, CANVA)).toEqual(chosen);
  });

  it("leaves the form alone once a description has been written", () => {
    const written = { ...BLANK, description: "Wording that prints on the cover sheet" };
    expect(fillFromTypedName(written, CANVA)).toEqual(written);
  });

  it("does not invent a line item for a vendor that has none", () => {
    const orphaned: VendorFill = { ...CANVA, lineItemId: null };
    expect(fillFromTypedName(BLANK, orphaned).lineItemId).toBe("");
  });
});

describe("payment source", () => {
  it("is filled when the remembered label is still active", () => {
    expect(fillFromClick(BLANK, CANVA, ACTIVE_SOURCES).paymentSource).toBe(
      "Paid by us, reimbursement requested",
    );
    expect(fillFromTypedName(BLANK, CANVA, ACTIVE_SOURCES).paymentSource).toBe(
      "Paid by us, reimbursement requested",
    );
  });

  it("is withheld once the label has been retired (R5.2)", () => {
    // A retired label stays readable on records that already carry it, but must never be
    // put on a new expense — so the vendor contributes nothing here.
    const retired = ["Paid directly by fiduciary"];
    expect(fillFromClick(BLANK, CANVA, retired).paymentSource).toBe("");
    expect(fillFromTypedName(BLANK, CANVA, retired).paymentSource).toBe("");
  });

  it("does not clear a chosen source when the remembered one is unusable", () => {
    const chosen = { ...BLANK, paymentSource: "Paid directly by fiduciary" };
    expect(fillFromClick(chosen, CANVA, ["Paid directly by fiduciary"]).paymentSource).toBe(
      "Paid directly by fiduciary",
    );
  });

  it("overwrites a chosen source on click when the remembered one is active", () => {
    const chosen = { ...BLANK, paymentSource: "Paid directly by fiduciary" };
    expect(fillFromClick(chosen, CANVA, ACTIVE_SOURCES).paymentSource).toBe(
      "Paid by us, reimbursement requested",
    );
  });

  it("fills nothing when no active list is supplied, rather than guessing", () => {
    // Fails safe: a caller that forgets to pass the list cannot resurrect a retired label.
    expect(fillFromClick(BLANK, CANVA).paymentSource).toBe("");
  });

  it("is left alone for a vendor that never learned one", () => {
    const unlearned: VendorFill = { ...CANVA, paymentSource: null };
    const chosen = { ...BLANK, paymentSource: "Paid directly by fiduciary" };
    expect(fillFromClick(chosen, unlearned, ACTIVE_SOURCES).paymentSource).toBe(
      "Paid directly by fiduciary",
    );
  });
});

describe("fillFromClick", () => {
  it("replaces a line item and description already set", () => {
    // Clicking is deliberate. Filling blanks only made picking a vendor look like a no-op.
    const current = {
      ...BLANK,
      lineItemId: "line-salary",
      description: "My own wording",
      name: "Can",
    };
    const result = fillFromClick(current, CANVA);
    expect(result.name).toBe("Canva");
    expect(result.lineItemId).toBe("line-promo");
    expect(result.description).toBe(CANVA.description);
  });

  it("never replaces an amount that has already been typed", () => {
    // The amount is the field that is new every time; a remembered one is only a start.
    const typed = { ...BLANK, subtotal: "999.99" };
    expect(fillFromClick(typed, CANVA).subtotal).toBe("999.99");
  });

  it("still offers the remembered amount when the box is empty", () => {
    expect(fillFromClick(BLANK, CANVA).subtotal).toBe("45.00");
  });

  it("overwrites tax and fees, which belong to the vendor rather than the occasion", () => {
    const current = { ...BLANK, tax: "88.00", fees: "77.00" };
    const result = fillFromClick(current, CANVA);
    expect(result.tax).toBe("2.50");
    expect(result.fees).toBe("1.25");
  });

  it("keeps what was typed when the vendor remembers no amounts", () => {
    const unlearned: VendorFill = {
      ...CANVA,
      subtotalCents: null,
      taxCents: null,
      feesCents: null,
    };
    const current = { ...BLANK, tax: "88.00", fees: "77.00" };
    const result = fillFromClick(current, unlearned);
    expect(result.tax).toBe("88.00");
    expect(result.fees).toBe("77.00");
  });

  it("does not blank a chosen line item for a vendor that has none", () => {
    const orphaned: VendorFill = { ...CANVA, lineItemId: null };
    const current = { ...BLANK, lineItemId: "line-salary" };
    expect(fillFromClick(current, orphaned).lineItemId).toBe("line-salary");
  });

  it("applies a remembered zero over a typed figure", () => {
    // Distinct from the null case above: this vendor is known to charge no tax.
    const zeroTax: VendorFill = { ...CANVA, taxCents: 0 };
    expect(fillFromClick({ ...BLANK, tax: "88.00" }, zeroTax).tax).toBe("0.00");
  });

  it("leaves fields the vendor knows nothing about untouched", () => {
    const current = { ...BLANK, paymentSource: "Paid by us", note: "keep me", date: "2026-02-14" };
    const result = fillFromClick(current, CANVA);
    expect(result.paymentSource).toBe("Paid by us");
    expect(result.note).toBe("keep me");
    expect(result.date).toBe("2026-02-14");
  });
});
