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
  /** Set when this expense was created by a one-click add. */
  recurringItemId?: string | null;
};

export type AddedState = {
  added: boolean;
  /** The expense Remove would delete — the newest match. */
  targetExpenseId: string | null;
  /** Removing a documented expense throws work away, so it is confirmed first. */
  requiresConfirmation: boolean;
  /**
   * Whether the target was created by this recurring item's one-click add, rather than
   * merely sharing its payee and line item. Removing something the user typed themselves
   * is a different act from undoing a click, and is worded differently.
   */
  createdByThisItem: boolean;
};

/**
 * Whether a recurring item has already been added to the month.
 *
 * Display matching is by name (case-insensitively, since the user may have retyped it) plus
 * line item, as R8.3 specifies — the row is telling the user this month already has such a
 * record, whoever entered it, purely informational.
 *
 * Removal is held to a stricter standard than display: `targetExpenseId` is only ever set
 * for an expense this item actually created (the `recurringItemId` link). A name-and-line-item
 * match that isn't linked was typed in by the user — Remove has nothing it may act on, so it
 * gets no target at all, not even a confirmable one. A confirmation dialog is a warning, not
 * a guarantee: a rushed "Remove anyway" click on a busy day is exactly how a hand-typed record
 * was permanently lost before, twice over (first as a hard delete, then — even softened to a
 * trash entry — as a record that still left its month). Marking something recurring must never
 * be able to move or remove a record it didn't create, full stop.
 */
export function addedState(
  recurring: RecurringMatchable,
  monthExpenses: readonly ExpenseMatchable[],
  /** The recurring item's id, when known — expenses it created are matched exactly. */
  recurringItemId?: string,
): AddedState {
  const name = recurring.name.trim().toLowerCase();

  // An expense this item actually created is an exact match. Falling back to name matching
  // is for *display* only (below) — it must never feed a delete target, or Remove could reach
  // a manually entered expense that merely shares a payee and line item.
  const linked = recurringItemId
    ? monthExpenses.filter((expense) => expense.recurringItemId === recurringItemId)
    : [];

  const matches =
    linked.length > 0
      ? linked
      : monthExpenses.filter(
          (expense) =>
            expense.lineItemId === recurring.lineItemId &&
            expense.name.trim().toLowerCase() === name,
        );

  if (matches.length === 0) {
    return {
      added: false,
      targetExpenseId: null,
      requiresConfirmation: false,
      createdByThisItem: false,
    };
  }

  const newest = matches.reduce((latest, candidate) =>
    candidate.sortOrder > latest.sortOrder ? candidate : latest,
  );

  const createdByThisItem = Boolean(
    recurringItemId && newest.recurringItemId === recurringItemId,
  );

  return {
    added: true,
    // Never a hand-typed match: see the doc comment above.
    targetExpenseId: createdByThisItem ? newest.id : null,
    requiresConfirmation: createdByThisItem && newest.documentCount > 0,
    createdByThisItem,
  };
}

/** Confirmation wording when Remove would discard attached files. Only ever shown for an
 * expense this recurring item actually created — see addedState. */
export function removeConfirmation(name: string, documentCount: number): string {
  const files =
    documentCount > 0
      ? ` and ${documentCount} attached file${documentCount === 1 ? "" : "s"}`
      : "";
  return `Remove ${name}? This deletes the expense${files}.`;
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

/** The Recurring tab's "no line item filter" option, and the value the Select shows for it. */
export const ALL_LINE_ITEMS = "All line items";

/**
 * Does a recurring item survive the tab's search and line item filter?
 *
 * Shared deliberately. The list uses it to decide what to render, and the save handler uses it
 * to decide whether a just-saved item would land outside the current controls — adding "Acme"
 * while the search reads "Zephyr" otherwise saves into a list that cannot show it, which reads
 * as a save that failed. Two copies of this predicate would be two things that must agree, and
 * that is how every defect this project has shipped began.
 */
export function matchesRecurringFilters(
  row: { name: string; defaultDescription: string; lineItemName: string },
  filters: { query: string; lineFilter: string },
): boolean {
  const term = filters.query.trim().toLowerCase();
  return (
    (filters.lineFilter === ALL_LINE_ITEMS || row.lineItemName === filters.lineFilter) &&
    (term === "" ||
      row.name.toLowerCase().includes(term) ||
      row.defaultDescription.toLowerCase().includes(term))
  );
}
