import { describe, expect, it } from "vitest";

import { UI } from "@/src/domain/strings";

import type { ExpenseInput } from "./actions";
import { expenseRefusal, validate, validateFields } from "./validation";

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

/**
 * Usability #25: `createExpenseAction` / `updateExpenseAction` return every problem in one
 * round trip, keyed by the field it belongs to. `validateFields` is that rule set; `validate`
 * above is derived from it, so every assertion above must stay exactly as it was.
 */
describe("validateFields: every problem at once (usability #25)", () => {
  it("a valid input has no errors", () => {
    expect(validateFields(BASE)).toEqual({});
  });

  it("E1: an empty add form names name, line item, payment source and narrative together, in form order", () => {
    const errors = validateFields({ ...BASE, name: "", lineItemId: "", paymentSource: "", narrative: "" });
    expect(errors).toEqual({
      name: "Enter a name.",
      lineItemId: "Choose a line item.",
      paymentSource: "Choose a payment source.",
      narrative: UI.expenseMissingNarrative,
    });
    expect(Object.keys(errors)).toEqual(["name", "lineItemId", "paymentSource", "narrative"]);
  });

  it("E2: only the narrative blank gives only the narrative error", () => {
    expect(validateFields({ ...BASE, narrative: "" })).toEqual({
      narrative: "Enter a narrative for this expense.",
    });
  });

  it("E3: a whitespace-only narrative is a narrative error", () => {
    expect(validateFields({ ...BASE, narrative: "   " })).toEqual({
      narrative: "Enter a narrative for this expense.",
    });
  });

  it("E4: no receipt without a reason AND a blank narrative come back together", () => {
    expect(validateFields({ ...BASE, noReceipt: true, noReceiptReason: "  ", narrative: "" })).toEqual({
      noReceiptReason: UI.noReceiptReasonRequired,
      narrative: UI.expenseMissingNarrative,
    });
  });

  it("E4 boundary: no receipt WITH a reason is fine", () => {
    expect(validateFields({ ...BASE, noReceipt: true, noReceiptReason: "Vendor never sent one." })).toEqual({});
  });

  it("E5: two bad money fields come back together", () => {
    expect(validateFields({ ...BASE, subtotal: "12a3.45", tax: "1x2" })).toEqual({
      subtotal: "Enter a valid subtotal, like 1234.56.",
      tax: "Enter a valid tax amount, like 12.34.",
    });
  });

  it("every rule at once: all eleven keys", () => {
    const errors = validateFields({
      ...BASE,
      name: " ",
      fundingSourceId: "nope",
      lineItemId: "",
      paymentSource: "",
      month: "2026-13",
      date: "2026-02-30",
      subtotal: "x",
      tax: "y",
      fees: "z",
      noReceipt: true,
      noReceiptReason: "",
      narrative: "",
    });
    expect(Object.keys(errors)).toEqual([
      "name",
      "fundingSourceId",
      "lineItemId",
      "paymentSource",
      "month",
      "date",
      "subtotal",
      "tax",
      "fees",
      "noReceiptReason",
      "narrative",
    ]);
  });

  it("E10: an update with a blank narrative (legacy expense) is a narrative field error", () => {
    expect(validateFields({ ...BASE, id: "some-id", narrative: "" })).toEqual({
      narrative: UI.expenseMissingNarrative,
    });
  });

  it("E11: a draft may leave line item and narrative blank, and validate() still says null", () => {
    const draft = { ...BASE, lineItemId: "", narrative: "" };
    expect(validateFields(draft, { draft: true })).toEqual({});
    expect(validate(draft, { draft: true })).toBeNull();
    // ...but a draft still gets every other rule.
    expect(validateFields({ ...draft, name: "" }, { draft: true })).toEqual({ name: "Enter a name." });
  });

  it("validate() keeps today's one-sentence precedence: the combined message beats an earlier-listed rule", () => {
    // Before #25, the name/line item/payment check ran first; funding source came second.
    expect(validate({ ...BASE, fundingSourceId: "nope", paymentSource: "" })).toBe(UI.expenseMissingFields);
    // And a money error still beats the narrative, as today.
    expect(validate({ ...BASE, subtotal: "x", narrative: "" })).toBe("Enter a valid subtotal, like 1234.56.");
  });
});

/**
 * The shape check every path starts from (review ledger: validate by type, not truthiness). The
 * form always sends strings and real booleans; anything else is a crafted call or a foreign
 * client, refused as one message before any rule reads a field.
 */
describe("a request not shaped like the form's (create, update, draft, invoice)", () => {
  const MALFORMED: Record<string, unknown>[] = [
    { noReceipt: "false", noReceiptReason: "Lost" },
    { noReceipt: 1 },
    { noReceipt: true, noReceiptReason: 42 },
    { taxReimbursable: "true" },
    { feesReimbursable: null },
    { name: 7 },
    { narrative: undefined },
    { subtotal: 12.5 },
    { lineItemId: ["x"] },
  ];

  for (const overrides of MALFORMED) {
    const bad = { ...BASE, ...overrides } as unknown as ExpenseInput;
    it(`${JSON.stringify(overrides)} is refused by both entry points, draft or not`, () => {
      expect(expenseRefusal(bad)).toEqual({ error: UI.requestRefused });
      expect(validate(bad)).toBe(UI.requestRefused);
      expect(validate(bad, { draft: true })).toBe(UI.requestRefused);
    });
  }

  it("a missing object, or a missing field, is refused rather than thrown", () => {
    expect(expenseRefusal(null as unknown as ExpenseInput)).toEqual({ error: UI.requestRefused });
    expect(validate("x" as unknown as ExpenseInput)).toBe(UI.requestRefused);
    const withoutNarrative: Partial<ExpenseInput> = { ...BASE };
    delete withoutNarrative.narrative;
    expect(validate(withoutNarrative as ExpenseInput)).toBe(UI.requestRefused);
  });

  it("a well-shaped input is unchanged: null when valid, every field error at once when not", () => {
    expect(expenseRefusal(BASE)).toBeNull();
    // The id is not shape-checked here: the actions check it themselves (isUuid).
    expect(expenseRefusal({ ...BASE, id: "anything" })).toBeNull();
    expect(expenseRefusal({ ...BASE, name: "", narrative: "" })).toEqual({
      error: `Enter a name. ${UI.expenseMissingNarrative}`,
      fieldErrors: { name: "Enter a name.", narrative: UI.expenseMissingNarrative },
    });
  });
});
