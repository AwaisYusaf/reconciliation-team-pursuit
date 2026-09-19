/**
 * Line item lifecycle rules (domain-rules §9).
 *
 * The decision of whether a line item may be deleted — and what the user must confirm
 * first — is domain logic, not plumbing, so it lives here where it can be exercised
 * without a database or a request.
 */
import { formatMoney } from "./format";
import { lineItemDeleteBlocked } from "./strings";

export type DeletePlan =
  | { allowed: false; reason: string }
  | { allowed: true; cascadingRecurring: string[]; performanceTotalCents: number };

/**
 * Whether a line item can be removed (R9.3).
 *
 * Expenses block deletion outright: they are the historical record the packet is built
 * from. Recurring items do not block it — they are a convenience list — but they are
 * cascade-deleted, so the user is shown exactly what goes with it. Performances (m08) cascade
 * the same way — they are amounts on the line item, not a record of their own — but their
 * total is still named in the confirmation, since it is real budget money being discarded.
 */
export function planLineItemDelete(input: {
  name: string;
  expenseCount: number;
  recurringNames: readonly string[];
  performanceTotalCents: number;
}): DeletePlan {
  if (input.expenseCount > 0) {
    return { allowed: false, reason: lineItemDeleteBlocked(input.name) };
  }
  return {
    allowed: true,
    cascadingRecurring: [...input.recurringNames],
    performanceTotalCents: input.performanceTotalCents,
  };
}

/** Wording for the cascade confirmation, listing what will be removed alongside. */
export function cascadeConfirmation(
  recurringNames: readonly string[],
  performanceTotalCents = 0,
): string {
  const count = recurringNames.length;
  const parts: string[] = [];
  if (performanceTotalCents > 0) {
    parts.push(`${formatMoney(performanceTotalCents)} of added performances`);
  }
  if (count > 0) {
    parts.push(`${count} recurring item${count === 1 ? "" : "s"}: ${recurringNames.join(", ")}`);
  }
  // An empty list still gets a sentence. Deleting a line item used to be confirmed only when
  // recurring items came with it, so an empty one — a name and its budget figures — went on the
  // first click, from a control sitting beside Edit.
  if (parts.length === 0) {
    return "Its name and budget figures will be deleted. This can't be undone.";
  }
  return `Deleting also removes ${parts.join(" and ")}.`;
}

/** True when `candidate` collides with an existing name, ignoring case (R9.1). */
export function isDuplicateName(
  candidate: string,
  existing: ReadonlyArray<{ id: string; name: string }>,
  ignoreId?: string,
): boolean {
  const target = candidate.trim().toLowerCase();
  return existing.some((item) => item.id !== ignoreId && item.name.toLowerCase() === target);
}

/** Move an item within an ordered list, returning the new order. Out-of-range moves are no-ops. */
export function moveInOrder<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return [...items];
  }
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
