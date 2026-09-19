import { describe, expect, it } from "vitest";

import {
  ALL_LINE_ITEMS,
  addedState,
  matchesRecurringFilters,
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

  it("shows added when several name matches exist, but none is a Remove target without a link (D-79)", () => {
    // No recurringItemId passed — none of these can be "created by this item," so "newest"
    // among them is no longer a meaningful question for removal, only for display.
    const state = addedState(adobe, [
      expense({ id: "manual", sortOrder: 3 }),
      expense({ id: "one-click", sortOrder: 11 }),
      expense({ id: "older", sortOrder: 1 }),
    ]);
    expect(state.added).toBe(true);
    expect(state.targetExpenseId).toBeNull();
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

describe("link matching only — a name match is display, never a Remove target (D-79)", () => {
  it("targets the expense this item actually created, ignoring a same-named manual entry", () => {
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

  it("gives Remove no target when the only match belongs to a different recurring item", () => {
    const state = addedState(
      adobe,
      [expense({ id: "other", recurringItemId: "rec-2" })],
      "rec-1",
    );
    // Still shown as added (informational — this month already has an Adobe expense), but
    // this item did not create it, so Remove must not be able to reach it.
    expect(state.added).toBe(true);
    expect(state.createdByThisItem).toBe(false);
    expect(state.targetExpenseId).toBeNull();
  });

  it("gives Remove no target for a row with no link at all — a name match is display only", () => {
    // This is the exact shape of the reported bug: a hand-typed expense (recurringItemId
    // null) that happens to share a name and line item with a newly created recurring item.
    // Confirmed live: Metro Parking, $180, May 2026 — marking it recurring must never be able
    // to move or delete the hand-typed record, so it stays untouched no matter what Remove
    // does with it.
    const state = addedState(adobe, [expense({ id: "hand-typed", recurringItemId: null })], "rec-1");
    expect(state.added).toBe(true);
    expect(state.createdByThisItem).toBe(false);
    expect(state.targetExpenseId).toBeNull();
    expect(state.requiresConfirmation).toBe(false);
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
      "Enter an amount other than $0.00.",
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
 * this month already has such a record, whoever entered it. Removal is the dangerous half:
 * it only ever targets an expense carrying this item's own link, full stop (D-79) — a name
 * match alone never gives it anything to act on.
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

  it("still shows added for a manually entered expense sharing the payee (R8.3 display), but gives Remove nothing to target", () => {
    const month = [expense({ id: "exp-9" })];
    const state = addedState(item, month, item.id);

    expect(state.added).toBe(true);
    // But it is not this item's to undo — not even behind a confirmation. Marking something
    // recurring must never be able to move or remove a record it didn't create (D-79).
    expect(state.createdByThisItem).toBe(false);
    expect(state.targetExpenseId).toBeNull();
    expect(state.requiresConfirmation).toBe(false);
  });

  it("confirms before deleting a documented expense it created", () => {
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
  // Only ever shown for an expense this recurring item actually created (see addedState /
  // D-79) — a hand-typed match is refused by the action before a confirmation is offered.
  it("says plainly what will be deleted", () => {
    expect(removeConfirmation("Quincy Smith", 0)).toBe(
      "This moves the Quincy Smith expense to the trash. You can restore it from there.",
    );
    expect(removeConfirmation("Quincy Smith", 2)).toBe(
      "This moves the Quincy Smith expense and its 2 attached files to the trash. You can restore it from there.",
    );
  });
});

describe("matchesRecurringFilters", () => {
  const row = {
    name: "Zephyr Logistics",
    defaultDescription: "Quarterly retainer",
    lineItemName: "Travel",
  };
  const unfiltered = { query: "", lineFilter: ALL_LINE_ITEMS };

  it("keeps everything when nothing is filtered", () => {
    expect(matchesRecurringFilters(row, unfiltered)).toBe(true);
  });

  it("searches the name and the description, case-insensitively", () => {
    expect(matchesRecurringFilters(row, { ...unfiltered, query: "zephyr" })).toBe(true);
    expect(matchesRecurringFilters(row, { ...unfiltered, query: "RETAINER" })).toBe(true);
    expect(matchesRecurringFilters(row, { ...unfiltered, query: "haulage" })).toBe(false);
  });

  it("ignores surrounding whitespace, so a stray space does not empty the table", () => {
    expect(matchesRecurringFilters(row, { ...unfiltered, query: "  zephyr  " })).toBe(true);
    expect(matchesRecurringFilters(row, { ...unfiltered, query: "   " })).toBe(true);
  });

  it("filters by line item", () => {
    expect(matchesRecurringFilters(row, { query: "", lineFilter: "Travel" })).toBe(true);
    expect(matchesRecurringFilters(row, { query: "", lineFilter: "Salaries" })).toBe(false);
  });

  it("requires the search and the filter to agree, not either one", () => {
    expect(matchesRecurringFilters(row, { query: "zephyr", lineFilter: "Travel" })).toBe(true);
    // Matches the search but sits under another line item — it must stay hidden.
    expect(matchesRecurringFilters(row, { query: "zephyr", lineFilter: "Salaries" })).toBe(false);
  });

  it("is the predicate the save handler needs: a new row outside the controls does not match", () => {
    // Saving "Acme" while the search reads "Zephyr" is what makes the tab clear its controls.
    const saved = { name: "Acme", defaultDescription: "", lineItemName: "Travel" };
    expect(matchesRecurringFilters(saved, { query: "Zephyr", lineFilter: ALL_LINE_ITEMS })).toBe(
      false,
    );
  });
});
