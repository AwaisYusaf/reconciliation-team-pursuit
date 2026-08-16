import { describe, expect, it } from "vitest";

import {
  cascadeConfirmation,
  isDuplicateName,
  moveInOrder,
  planLineItemDelete,
} from "./line-item-rules";

describe("planLineItemDelete (R9.3)", () => {
  it("refuses while expenses reference the line item, using the canonical message", () => {
    const plan = planLineItemDelete({ name: "Salary", expenseCount: 9, recurringNames: [] });
    expect(plan.allowed).toBe(false);
    expect(plan.allowed === false && plan.reason).toBe(
      "“Salary” has expenses recorded against it and cannot be deleted.",
    );
  });

  it("blocks on a single expense in any month, not just the active one", () => {
    expect(
      planLineItemDelete({ name: "Salary", expenseCount: 1, recurringNames: [] }).allowed,
    ).toBe(false);
  });

  it("allows deletion when nothing references it", () => {
    const plan = planLineItemDelete({ name: "Unused", expenseCount: 0, recurringNames: [] });
    expect(plan).toEqual({ allowed: true, cascadingRecurring: [] });
  });

  it("allows deletion with recurring items but reports the cascade for confirmation", () => {
    const plan = planLineItemDelete({
      name: "Analytical Support",
      expenseCount: 0,
      recurringNames: ["Adobe", "Hiscox"],
    });
    expect(plan).toEqual({ allowed: true, cascadingRecurring: ["Adobe", "Hiscox"] });
  });

  it("lets expenses win over recurring items — the refusal comes first", () => {
    const plan = planLineItemDelete({
      name: "Salary",
      expenseCount: 2,
      recurringNames: ["Quincy Smith"],
    });
    expect(plan.allowed).toBe(false);
  });
});

describe("cascadeConfirmation", () => {
  it("names what will be removed alongside", () => {
    expect(cascadeConfirmation(["Adobe", "Hiscox"])).toBe(
      "Deleting also removes 2 recurring items: Adobe, Hiscox.",
    );
  });

  it("uses the singular for one item", () => {
    expect(cascadeConfirmation(["Adobe"])).toBe("Deleting also removes 1 recurring item: Adobe.");
  });
});

describe("isDuplicateName (R9.1)", () => {
  const existing = [
    { id: "1", name: "Salary" },
    { id: "2", name: "Analytical Support" },
  ];

  it("matches regardless of case or surrounding space", () => {
    expect(isDuplicateName("Salary", existing)).toBe(true);
    expect(isDuplicateName("SALARY", existing)).toBe(true);
    expect(isDuplicateName("  salary  ", existing)).toBe(true);
  });

  it("accepts a genuinely new name", () => {
    expect(isDuplicateName("Office Space", existing)).toBe(false);
  });

  it("lets a line item keep its own name while editing", () => {
    expect(isDuplicateName("Salary", existing, "1")).toBe(false);
    expect(isDuplicateName("Salary", existing, "2")).toBe(true);
  });
});

describe("moveInOrder", () => {
  const items = ["a", "b", "c"];

  it("swaps with the neighbour", () => {
    expect(moveInOrder(items, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveInOrder(items, 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op at the ends", () => {
    expect(moveInOrder(items, 0, -1)).toEqual(items);
    expect(moveInOrder(items, 2, 1)).toEqual(items);
  });

  it("never mutates the input", () => {
    const original = [...items];
    moveInOrder(items, 0, 1);
    expect(items).toEqual(original);
  });
});
