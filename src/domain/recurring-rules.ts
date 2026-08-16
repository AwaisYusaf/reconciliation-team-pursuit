/**
 * Recurring item rules (domain-rules §8.3).
 *
 * Recurring items are a convenience list, never an automation: nothing is ever added to a
 * month without the user confirming it. Once added, the created expense carries no
 * documents, so the documentation gate immediately flags it — that is the reminder.
 */

export type RecurringMatchable = {
  name: string;
  lineItemId: string;
};

export type ExpenseMatchable = {
  id: string;
  name: string;
  lineItemId: string;
  /** Later entries are newer; used to pick which one Remove targets. */
  sortOrder: number;
  documentCount: number;
};

export type AddedState = {
  added: boolean;
  /** The expense Remove would delete — the newest match. */
  targetExpenseId: string | null;
  /** Removing a documented expense throws work away, so it is confirmed first. */
  requiresConfirmation: boolean;
};

/**
 * Whether a recurring item has already been added to the month.
 *
 * Matching is by name (case-insensitively, since the user may have retyped it) plus line
 * item. When several match — a manual entry alongside a one-click add — Remove targets the
 * newest, so it undoes the most recent action rather than an arbitrary one.
 */
export function addedState(
  recurring: RecurringMatchable,
  monthExpenses: readonly ExpenseMatchable[],
): AddedState {
  const name = recurring.name.trim().toLowerCase();

  const matches = monthExpenses.filter(
    (expense) =>
      expense.lineItemId === recurring.lineItemId &&
      expense.name.trim().toLowerCase() === name,
  );

  if (matches.length === 0) {
    return { added: false, targetExpenseId: null, requiresConfirmation: false };
  }

  const newest = matches.reduce((latest, candidate) =>
    candidate.sortOrder > latest.sortOrder ? candidate : latest,
  );

  return {
    added: true,
    targetExpenseId: newest.id,
    requiresConfirmation: newest.documentCount > 0,
  };
}

/** Confirmation wording when Remove would discard attached files. */
export function removeConfirmation(name: string, documentCount: number): string {
  return `${name} already has ${documentCount} attached file${
    documentCount === 1 ? "" : "s"
  }. Removing it deletes the expense and those files.`;
}

/** Validation for the add/edit form (R8.3). */
export function validateRecurring(input: {
  name: string;
  amountCents: number | null;
  lineItemId: string;
}): string | null {
  if (!input.name.trim() || !input.lineItemId || input.amountCents === null) {
    return "Enter a name, an amount, and a line item.";
  }
  if (input.amountCents === 0) return "Enter an amount.";
  return null;
}
