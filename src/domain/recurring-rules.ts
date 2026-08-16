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
 * record, whoever entered it. When several match, Remove targets the newest, so it undoes
 * the most recent action rather than an arbitrary one.
 *
 * Removal is held to a stricter standard than display. An expense this item actually
 * created can be removed on the same terms as any undo; one that merely shares a payee was
 * typed by the user, and deleting it is always confirmed first even when it carries no
 * documents.
 */
export function addedState(
  recurring: RecurringMatchable,
  monthExpenses: readonly ExpenseMatchable[],
  /** The recurring item's id, when known — expenses it created are matched exactly. */
  recurringItemId?: string,
): AddedState {
  const name = recurring.name.trim().toLowerCase();

  // An expense this item actually created is an exact match. Falling back to name matching
  // would risk targeting a manually entered expense that merely shares a payee and line
  // item, deleting work the user never meant to undo.
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
    targetExpenseId: newest.id,
    // Confirmed when files would be lost, and always when the expense is not this item's
    // to undo.
    requiresConfirmation: newest.documentCount > 0 || !createdByThisItem,
    createdByThisItem,
  };
}

/** Confirmation wording when Remove would discard attached files. */
export function removeConfirmation(
  name: string,
  documentCount: number,
  createdByThisItem = true,
): string {
  const files =
    documentCount > 0
      ? ` and ${documentCount} attached file${documentCount === 1 ? "" : "s"}`
      : "";

  // An expense this item did not create was entered by hand, and saying so is the whole
  // point of asking — the user may not realise the two are being treated as the same record.
  return createdByThisItem
    ? `Remove ${name}? This deletes the expense${files}.`
    : `The ${name} expense in this month was not added from this recurring item. Removing it deletes that expense${files}.`;
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
