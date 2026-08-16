import { describe, expect, it } from "vitest";

import {
  addedState,
  removeConfirmation,
  validateRecurring,
  type ExpenseMatchable,
} from "./recurring-rules";

const adobe = { name: "Adobe", lineItemId: "analytical" };

function expense(overrides: Partial<ExpenseMatchable> = {}): ExpenseMatchable {
  return {
    id: "e1",
    name: "Adobe",
    lineItemId: "analytical",
    sortOrder: 1,
    documentCount: 0,
    ...overrides,
  };
}

describe("addedState (R8.3)", () => {
  it("is not added when the month holds nothing matching", () => {
    expect(addedState(adobe, [])).toEqual({
      added: false,
      targetExpenseId: null,
      requiresConfirmation: false,
    });
  });

  it("detects an added item and points Remove at it", () => {
    const state = addedState(adobe, [expense({ id: "adobe-1" })]);
    expect(state.added).toBe(true);
    expect(state.targetExpenseId).toBe("adobe-1");
    expect(state.requiresConfirmation).toBe(false);
  });

  it("matches the name case-insensitively and ignores surrounding space", () => {
    expect(addedState(adobe, [expense({ name: "  adobe " })]).added).toBe(true);
    expect(addedState({ ...adobe, name: " ADOBE" }, [expense()]).added).toBe(true);
  });

  it("does not match the same name on a different line item", () => {
    expect(addedState(adobe, [expense({ lineItemId: "promo" })]).added).toBe(false);
  });

  it("does not match a different name on the same line item", () => {
    expect(addedState(adobe, [expense({ name: "Adobe Stock" })]).added).toBe(false);
  });

  it("targets the newest when a manual entry and a one-click add collide", () => {
    const state = addedState(adobe, [
      expense({ id: "manual", sortOrder: 3 }),
      expense({ id: "one-click", sortOrder: 11 }),
      expense({ id: "older", sortOrder: 1 }),
    ]);
    expect(state.targetExpenseId).toBe("one-click");
  });

  it("requires confirmation only when the target carries documents", () => {
    expect(addedState(adobe, [expense({ documentCount: 0 })]).requiresConfirmation).toBe(false);
    expect(addedState(adobe, [expense({ documentCount: 2 })]).requiresConfirmation).toBe(true);
  });

  it("judges confirmation on the newest match, not on any match", () => {
    const state = addedState(adobe, [
      expense({ id: "old", sortOrder: 1, documentCount: 5 }),
      expense({ id: "new", sortOrder: 9, documentCount: 0 }),
    ]);
    expect(state.targetExpenseId).toBe("new");
    expect(state.requiresConfirmation).toBe(false);
  });
});

describe("removeConfirmation", () => {
  it("says what will be lost", () => {
    expect(removeConfirmation("Adobe", 2)).toBe(
      "Adobe already has 2 attached files. Removing it deletes the expense and those files.",
    );
    expect(removeConfirmation("Adobe", 1)).toContain("1 attached file.");
  });
});

describe("validateRecurring", () => {
  it("requires a name, an amount and a line item", () => {
    const message = "Enter a name, an amount, and a line item.";
    expect(validateRecurring({ name: "", amountCents: 100, lineItemId: "x" })).toBe(message);
    expect(validateRecurring({ name: "Adobe", amountCents: null, lineItemId: "x" })).toBe(message);
    expect(validateRecurring({ name: "Adobe", amountCents: 100, lineItemId: "" })).toBe(message);
  });

  it("rejects a zero amount but allows a negative one (a recurring credit)", () => {
    expect(validateRecurring({ name: "Adobe", amountCents: 0, lineItemId: "x" })).toBe(
      "Enter an amount.",
    );
    expect(validateRecurring({ name: "Refund", amountCents: -5000, lineItemId: "x" })).toBeNull();
  });

  it("accepts a valid item", () => {
    expect(validateRecurring({ name: "Adobe", amountCents: 9999, lineItemId: "x" })).toBeNull();
  });
});
