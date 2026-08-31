import { describe, expect, it } from "vitest";

import { coverSheetRow, coverSheetRows, inlineNotes, type CoverSheetExpense } from "./cover-sheet";
import { TAX_NOTE } from "./strings";

function expense(overrides: Partial<CoverSheetExpense> = {}): CoverSheetExpense {
  return {
    name: "Kroger",
    description: "Groceries for participant families",
    subtotalCents: 42108,
    taxCents: 0,
    feesCents: 0, taxReimbursable: false, feesReimbursable: true,
    note: null,
    narrative: null,
    noReceipt: false,
    noReceiptReason: null,
    ...overrides,
  };
}

describe("inline notes (R6.5, R6.7)", () => {
  it("has none when nothing applies", () => {
    expect(inlineNotes(expense())).toEqual([]);
  });

  it("prints the tax note whenever tax was excluded, verbatim", () => {
    expect(inlineNotes(expense({ taxCents: 1 }))).toEqual([TAX_NOTE]);
  });

  it("does not print the tax note when there is no tax", () => {
    expect(inlineNotes(expense({ taxCents: 0 }))).toEqual([]);
  });

  it("prints a custom note on its own", () => {
    expect(inlineNotes(expense({ note: "Aggregated from four receipts" }))).toEqual([
      "Aggregated from four receipts",
    ]);
  });

  /**
   * The scope of work says the tax note is always appended when tax was excluded. A custom
   * note adds to it and never replaces it (D-22) — getting this backwards would drop a
   * disclosure the City relies on.
   */
  it("prints both, custom note first (D-22)", () => {
    expect(inlineNotes(expense({ note: "Split across two invoices", taxCents: 500 }))).toEqual([
      "Split across two invoices",
      TAX_NOTE,
    ]);
  });

  it("appends the no-receipt disclosure last, with its reason (R6.7)", () => {
    expect(
      inlineNotes(
        expense({
          note: "Paid in cash",
          taxCents: 500,
          noReceipt: true,
          noReceiptReason: "vendor closed",
        }),
      ),
    ).toEqual([
      "Paid in cash",
      TAX_NOTE,
      "(Note: No receipt available — vendor closed)",
    ]);
  });

  it("ignores a whitespace-only custom note rather than printing an empty highlight", () => {
    expect(inlineNotes(expense({ note: "   " }))).toEqual([]);
  });

  it("omits the disclosure when the flag is set but the reason is missing", () => {
    // R4.2 makes the reason mandatory and both the action and a check constraint enforce
    // it, so this is a malformed row rather than a note worth printing half-formed.
    expect(inlineNotes(expense({ noReceipt: true, noReceiptReason: "  " }))).toEqual([]);
  });
});

describe("cover sheet rows (R6.2)", () => {
  it("uses the expense name and its description verbatim", () => {
    const row = coverSheetRow(expense());
    expect(row.name).toBe("Kroger");
    expect(row.role).toBe("Groceries for participant families");
  });

  it("amounts are reimbursable, so tax is excluded and fees are included (R1.3)", () => {
    const row = coverSheetRow(expense({ subtotalCents: 19084, taxCents: 1500, feesCents: 250 , taxReimbursable: false, feesReimbursable: true}));
    expect(row.amountCents).toBe(19334);
  });

  it("totals the reimbursable amounts, not the gross", () => {
    const { rows, totalCents } = coverSheetRows([
      expense({ subtotalCents: 42108, taxCents: 2526 }),
      expense({ subtotalCents: 19084, taxCents: 0, feesCents: 250 , taxReimbursable: false, feesReimbursable: true}),
      expense({ subtotalCents: 61000 }),
    ]);

    expect(rows).toHaveLength(3);
    expect(totalCents).toBe(42108 + 19334 + 61000);
  });

  it("keeps entry order — no auto-sorting (R6.2)", () => {
    const { rows } = coverSheetRows([
      expense({ name: "Zebra" }),
      expense({ name: "Apple" }),
      expense({ name: "Mango" }),
    ]);
    expect(rows.map((row) => row.name)).toEqual(["Zebra", "Apple", "Mango"]);
  });

  it("produces no rows and a zero total for an empty line item", () => {
    expect(coverSheetRows([])).toEqual({ rows: [], totalCents: 0 });
  });

  it("normalises an empty narrative to null so no blank paragraph is rendered", () => {
    expect(coverSheetRow(expense({ narrative: "   " })).narrative).toBeNull();
    expect(coverSheetRow(expense({ narrative: "Context here" })).narrative).toBe("Context here");
  });

  it("handles a refund without inventing a negative total (R3)", () => {
    const { totalCents } = coverSheetRows([
      expense({ subtotalCents: 10000 }),
      expense({ subtotalCents: -2500 }),
    ]);
    expect(totalCents).toBe(7500);
  });
});

describe("the exclusion note tells the truth (R6.5, D-67)", () => {
  const base = {
    name: "Canva",
    description: "Design tool",
    subtotalCents: 10_000,
    taxCents: 600,
    feesCents: 125,
    note: null,
    narrative: null,
    noReceipt: false,
    noReceiptReason: null,
  };

  it("keeps the approved wording, unchanged, when tax is the excluded part", () => {
    // Byte-identical to the note in the February packet the funder approved.
    expect(inlineNotes({ ...base, taxReimbursable: false, feesReimbursable: true })).toEqual([
      "(Note: Statement includes tax which was excluded from reimbursement amount)",
    ]);
  });

  it("says nothing when the whole receipt is reimbursed", () => {
    // The note exists to explain a gap between the receipt and the claim. With no gap, the
    // old wording would assert something false on a document sent to the funder.
    expect(inlineNotes({ ...base, taxReimbursable: true, feesReimbursable: true })).toEqual([]);
  });

  it("names fees when fees are the excluded part", () => {
    expect(inlineNotes({ ...base, taxReimbursable: true, feesReimbursable: false })).toEqual([
      "(Note: Statement includes fees which were excluded from reimbursement amount)",
    ]);
  });

  it("uses one combined note rather than two near-identical ones", () => {
    expect(inlineNotes({ ...base, taxReimbursable: false, feesReimbursable: false })).toEqual([
      "(Note: Statement includes tax and fees which were excluded from reimbursement amount)",
    ]);
  });

  it("stays silent about a part that is zero, however it is flagged", () => {
    const noExtras = { ...base, taxCents: 0, feesCents: 0 };
    expect(inlineNotes({ ...noExtras, taxReimbursable: false, feesReimbursable: false })).toEqual(
      [],
    );
  });

  it("still prints alongside a custom note, in R6.5 order (D-22)", () => {
    const notes = inlineNotes({
      ...base,
      note: "Split with partner org",
      taxReimbursable: false,
      feesReimbursable: true,
    });
    expect(notes[0]).toBe("Split with partner org");
    expect(notes[1]).toContain("excluded from reimbursement");
  });

  it("puts the reimbursable amount on the row, not the receipt total", () => {
    const { rows } = coverSheetRows([
      { ...base, taxReimbursable: true, feesReimbursable: false },
    ]);
    // subtotal + tax, fees excluded.
    expect(rows[0].amountCents).toBe(10_600);
  });
});
