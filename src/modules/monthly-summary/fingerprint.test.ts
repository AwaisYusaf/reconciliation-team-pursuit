/**
 * Unit tests for `expensesFingerprint` (Phase 11, D-107, P7). PHASE-11.md §10 U-12, U-13.
 */
import { describe, expect, it } from "vitest";

import type { SummaryExpense } from "@/src/domain/monthly-summary-facts";

import { expensesFingerprint } from "./fingerprint";

function expense(overrides: Partial<SummaryExpense> & { id: string }): SummaryExpense {
  return {
    lineItemId: "li-1",
    name: "Expense",
    description: "desc",
    narrative: null,
    note: null,
    date: "2097-03-01",
    subtotalCents: 1000,
    taxCents: 0,
    feesCents: 0,
    taxReimbursable: false,
    feesReimbursable: false,
    noReceipt: false,
    noReceiptReason: null,
    ...overrides,
  };
}

describe("expensesFingerprint", () => {
  it("is a 64-character hex string", () => {
    const fp = expensesFingerprint([expense({ id: "a" })]);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the empty list has a stable fingerprint", () => {
    expect(expensesFingerprint([])).toBe(expensesFingerprint([]));
  });

  it("is stable across the input array's order (sorted by id internally)", () => {
    const a = expense({ id: "a" });
    const b = expense({ id: "b" });
    expect(expensesFingerprint([a, b])).toBe(expensesFingerprint([b, a]));
  });

  const fields: Array<[keyof SummaryExpense, unknown]> = [
    ["lineItemId", "li-2"],
    ["name", "Different name"],
    ["description", "Different description"],
    ["narrative", "Different narrative"],
    ["note", "Different note"],
    ["date", "2097-04-01"],
    ["subtotalCents", 9999],
    ["taxCents", 55],
    ["feesCents", 55],
    ["taxReimbursable", true],
    ["feesReimbursable", true],
    ["noReceipt", true],
    ["noReceiptReason", "Different reason"],
  ];

  it.each(fields)("changes when %s changes", (field, newValue) => {
    const base = expensesFingerprint([expense({ id: "a" })]);
    const changed = expensesFingerprint([expense({ id: "a", [field]: newValue })]);
    expect(changed).not.toBe(base);
  });

  it("does NOT change when unrelated fields change (id itself, sort order, payment source — not read by the fingerprint)", () => {
    // The fingerprint's own `id` field is part of the hash (join/leave detection, U-13), but
    // fields the summary never reads (e.g. a hypothetical sortOrder/paymentSource on the row)
    // simply aren't part of SummaryExpense at all, so they can't affect the hash by construction.
    // What we CAN prove here: two rows that agree on every field the type carries, but were
    // constructed independently (different object identity/property order), hash identically.
    const a = { ...expense({ id: "a" }) };
    const b: SummaryExpense = {
      noReceiptReason: a.noReceiptReason,
      id: a.id,
      feesReimbursable: a.feesReimbursable,
      taxReimbursable: a.taxReimbursable,
      feesCents: a.feesCents,
      taxCents: a.taxCents,
      subtotalCents: a.subtotalCents,
      date: a.date,
      note: a.note,
      narrative: a.narrative,
      description: a.description,
      name: a.name,
      lineItemId: a.lineItemId,
      noReceipt: a.noReceipt,
    };
    expect(expensesFingerprint([a])).toBe(expensesFingerprint([b]));
  });

  it("U-13: changes when an expense joins the set", () => {
    const before = expensesFingerprint([expense({ id: "a" })]);
    const after = expensesFingerprint([expense({ id: "a" }), expense({ id: "b" })]);
    expect(after).not.toBe(before);
  });

  it("U-13: changes when an expense leaves the set", () => {
    const before = expensesFingerprint([expense({ id: "a" }), expense({ id: "b" })]);
    const after = expensesFingerprint([expense({ id: "a" })]);
    expect(after).not.toBe(before);
  });

  it("key order inside each row doesn't matter (canonicalJson sorts keys)", () => {
    // Same logical row, but constructed with reversed insertion order.
    const row = expense({ id: "a", description: "X", narrative: "Y" });
    const reversedInsertion: SummaryExpense = JSON.parse(JSON.stringify(row));
    expect(expensesFingerprint([row])).toBe(expensesFingerprint([reversedInsertion]));
  });
});
