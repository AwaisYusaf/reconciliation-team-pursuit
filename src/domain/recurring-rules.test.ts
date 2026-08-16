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
      createdByThisItem: false,
    });
  });

  it("detects an added item and points Remove at it", () => {
    const state = addedState(adobe, [expense({ id: "adobe-1", recurringItemId: "rec-1" })], "rec-1");
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

  it("requires confirmation when its own target carries documents", () => {
    const own = (documentCount: number) =>
      addedState(adobe, [expense({ documentCount, recurringItemId: "rec-1" })], "rec-1");

    expect(own(0).requiresConfirmation).toBe(false);
    expect(own(2).requiresConfirmation).toBe(true);
  });

  it("judges confirmation on the newest match, not on any match", () => {
    const state = addedState(
      adobe,
      [
        expense({ id: "old", sortOrder: 1, documentCount: 5, recurringItemId: "rec-1" }),
        expense({ id: "new", sortOrder: 9, documentCount: 0, recurringItemId: "rec-1" }),
      ],
      "rec-1",
    );
    expect(state.targetExpenseId).toBe("new");
    expect(state.requiresConfirmation).toBe(false);
  });
});

describe("link matching beats name matching", () => {
  it("targets the expense this item actually created", () => {
    const state = addedState(
      adobe,
      [
        // A manual entry the user typed themselves, same payee and line item.
        expense({ id: "manual", sortOrder: 9, recurringItemId: null }),
        // The one the recurring item created.
        expense({ id: "created", sortOrder: 2, recurringItemId: "rec-1" }),
      ],
      "rec-1",
    );
    // Without the link this would pick "manual" for being newer, and Remove would delete
    // work the user never meant to undo.
    expect(state.targetExpenseId).toBe("created");
  });

  it("ignores expenses created by a different recurring item", () => {
    const state = addedState(
      adobe,
      [expense({ id: "other", recurringItemId: "rec-2" })],
      "rec-1",
    );
    // No link match, so it falls back to name matching — which this row satisfies.
    expect(state.targetExpenseId).toBe("other");
  });

  it("falls back to name matching for rows added before the link existed", () => {
    const state = addedState(adobe, [expense({ id: "legacy", recurringItemId: null })], "rec-1");
    expect(state.added).toBe(true);
    expect(state.targetExpenseId).toBe("legacy");
  });

  it("picks the newest among several the same item created", () => {
    const state = addedState(
      adobe,
      [
        expense({ id: "first", sortOrder: 1, recurringItemId: "rec-1" }),
        expense({ id: "second", sortOrder: 7, recurringItemId: "rec-1" }),
      ],
      "rec-1",
    );
    expect(state.targetExpenseId).toBe("second");
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

/**
 * The Recurring screen and the actions it triggers must answer this question identically.
 * They did not: the screen omitted the recurring item's id and so always fell back to
 * matching on name and line item, while the actions passed the id and preferred the link.
 *
 * R8.3 wants the *display* to match on name and line item — the row is telling the user
 * this month already has such a record, whoever entered it. Removal is the dangerous half,
 * so it is held to a stricter standard.
 */
describe("the screen and the actions must agree (R8.3)", () => {
  const item = { id: "rec-1", name: "Quincy Smith", lineItemId: "salary" };

  function expense(overrides: Partial<ExpenseMatchable> & { id: string }): ExpenseMatchable {
    return {
      name: "Quincy Smith",
      lineItemId: "salary",
      sortOrder: 0,
      documentCount: 0,
      recurringItemId: null,
      ...overrides,
    };
  }

  it("recognises its own expense after the payee is corrected on the expense form", () => {
    // Created by one click, then renamed to fix a spelling: the link survives, the name does not.
    const month = [expense({ id: "exp-1", name: "Quincy Smyth", recurringItemId: "rec-1" })];

    const state = addedState(item, month, item.id);
    expect(state.added).toBe(true);
    expect(state.targetExpenseId).toBe("exp-1");
    expect(state.createdByThisItem).toBe(true);
    // Adding again would put a second salary line on the cover sheet and in the amount billed.
  });

  it("removing its own undocumented expense needs no confirmation", () => {
    const month = [expense({ id: "exp-1", recurringItemId: "rec-1" })];
    expect(addedState(item, month, item.id).requiresConfirmation).toBe(false);
  });

  it("still shows added for a manually entered expense sharing the payee (R8.3 display)", () => {
    const month = [expense({ id: "exp-9" })];
    const state = addedState(item, month, item.id);

    expect(state.added).toBe(true);
    // But it is not this item's to undo silently.
    expect(state.createdByThisItem).toBe(false);
    expect(state.requiresConfirmation).toBe(true);
  });

  it("confirms before deleting a documented expense either way", () => {
    const month = [expense({ id: "exp-1", recurringItemId: "rec-1", documentCount: 3 })];
    expect(addedState(item, month, item.id).requiresConfirmation).toBe(true);
  });

  it("prefers its own expense over a manual one when both are present", () => {
    const month = [
      expense({ id: "manual", sortOrder: 9 }),
      expense({ id: "mine", recurringItemId: "rec-1", sortOrder: 1 }),
    ];
    const state = addedState(item, month, item.id);

    // The linked one wins even though the manual entry is newer.
    expect(state.targetExpenseId).toBe("mine");
    expect(state.createdByThisItem).toBe(true);
  });

  it("still matches by name for rows created before the link column existed", () => {
    const month = [expense({ id: "exp-0" })];
    expect(addedState(item, month).added).toBe(true);
  });
});

describe("removeConfirmation wording", () => {
  it("says plainly what will be deleted when the item created it", () => {
    expect(removeConfirmation("Quincy Smith", 0)).toBe(
      "Remove Quincy Smith? This deletes the expense.",
    );
    expect(removeConfirmation("Quincy Smith", 2)).toBe(
      "Remove Quincy Smith? This deletes the expense and 2 attached files.",
    );
  });

  it("says so when the expense was entered by hand, not added from here", () => {
    expect(removeConfirmation("Adobe", 0, false)).toContain("was not added from this recurring item");
    expect(removeConfirmation("Adobe", 1, false)).toContain("and 1 attached file");
  });
});
