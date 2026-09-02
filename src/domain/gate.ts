/**
 * The documentation gate (domain-rules §4).
 *
 * The product's core promise: a packet cannot be downloaded while any record in the month
 * is missing its evidence, and the system says exactly what is missing. Every surface that
 * blocks a download — the packet screen, the cover sheets screen, the expenses strip —
 * derives its state here so the counts and wording can never disagree.
 */

/** Only `attached` documents count; a pending or failed upload is not evidence (R4.6). */
export type DocumentState = {
  kind: "proof" | "receipt" | "supporting";
  status: "pending" | "attached" | "failed";
};

export type GateExpense = {
  id: string;
  name: string;
  lineItemName: string;
  noReceipt: boolean;
  documents: readonly DocumentState[];
};

/** What an incomplete record is missing, in the vocabulary R4.4 prints. */
export type MissingKind = "proof" | "receipt" | "both";

export type DocumentationStatus = {
  hasProof: boolean;
  hasReceipt: boolean;
  complete: boolean;
  missing: MissingKind | null;
};

function hasAttached(documents: readonly DocumentState[], kind: DocumentState["kind"]): boolean {
  return documents.some((document) => document.kind === kind && document.status === "attached");
}

/**
 * Whether one expense satisfies the gate.
 *
 * Proof of payment is always required (R4.1). A receipt or justification is required too,
 * unless the expense is explicitly marked "no receipt available" with a reason, which the
 * cover sheet then discloses (R4.2, R6.7).
 */
export function documentationStatus(expense: GateExpense): DocumentationStatus {
  const hasProof = hasAttached(expense.documents, "proof");
  const hasReceipt = expense.noReceipt || hasAttached(expense.documents, "receipt");

  const missing: MissingKind | null =
    hasProof && hasReceipt ? null : !hasProof && !hasReceipt ? "both" : hasProof ? "receipt" : "proof";

  return { hasProof, hasReceipt, complete: missing === null, missing };
}

/** The exact phrase R4.4 uses for each missing state. */
export function missingPhrase(missing: MissingKind): string {
  switch (missing) {
    case "proof":
      return "missing proof of payment";
    case "receipt":
      return "missing receipt/justification";
    case "both":
      return "missing both";
  }
}

/** One blocking-list line: `{name} — {line item} — missing …` (R4.4). */
export function blockingLabel(expense: GateExpense, missing: MissingKind): string {
  return `${expense.name} — ${expense.lineItemName} — ${missingPhrase(missing)}`;
}

export type BlockingRecord = {
  expenseId: string;
  label: string;
  missing: MissingKind;
};

/** Every incomplete record in the given set, in the order supplied. */
export function blockingRecords(expenses: readonly GateExpense[]): BlockingRecord[] {
  const records: BlockingRecord[] = [];
  for (const expense of expenses) {
    const status = documentationStatus(expense);
    if (status.missing) {
      records.push({
        expenseId: expense.id,
        missing: status.missing,
        label: blockingLabel(expense, status.missing),
      });
    }
  }
  return records;
}

/** Packet and summary downloads are blocked while any record in the month is incomplete (R4.3). */
export function isMonthBlocked(expenses: readonly GateExpense[]): boolean {
  return expenses.some((expense) => !documentationStatus(expense).complete);
}

/**
 * A line item's cover sheet downloads are blocked while any of its own expenses is
 * incomplete (R4.3) — a different line item's gap must not hold this one hostage.
 */
export function isLineItemBlocked(
  expenses: readonly GateExpense[],
  lineItemName: string,
): boolean {
  return expenses.some(
    (expense) => expense.lineItemName === lineItemName && !documentationStatus(expense).complete,
  );
}

/**
 * Per-line-item readiness for the packet screen: a line item is complete when it has at
 * least one record and all of them are documented. An empty line item is reported
 * separately so the screen can show "0 · —" rather than a misleading "Yes".
 */
export function lineItemReadiness(
  expenses: readonly GateExpense[],
  lineItemName: string,
): { recordCount: number; complete: boolean; isEmpty: boolean } {
  const own = expenses.filter((expense) => expense.lineItemName === lineItemName);
  return {
    recordCount: own.length,
    isEmpty: own.length === 0,
    complete: own.length > 0 && own.every((expense) => documentationStatus(expense).complete),
  };
}

/**
 * The documentation filter offered on the expenses list, in the order it offers them.
 *
 * Lives here, with the rule it filters on, because the list must not form a second opinion
 * about what "missing" means. The page already runs `documentationStatus` server-side; the
 * filter reads the `missing` it produced. Deriving it again from the row's document arrays
 * would agree today and diverge the day R4.1/R4.2 change — silently, with no test failing.
 */
export const DOCUMENTATION_FILTERS = [
  "All records",
  "Missing documentation",
  "Missing proof of payment",
  "Missing receipt/justification",
] as const;

export type DocumentationFilter = (typeof DOCUMENTATION_FILTERS)[number];

/** The default, and the value that filters nothing out. */
export const ALL_DOCUMENTATION: DocumentationFilter = "All records";

/**
 * Does a row survive the documentation filter?
 *
 * Takes the row's `missing` rather than its documents, so this and the packet's blocking list
 * are the same judgement (R4.3, R4.4).
 *
 * A record missing *both* is missing proof of payment, and is also missing a
 * receipt/justification, so it answers to either of the specific choices. Treating "both" as
 * its own bucket would hide the worst records from the two filters most likely to be used to
 * hunt them down.
 */
export function matchesDocumentationFilter(
  row: { missing: MissingKind | null },
  filter: DocumentationFilter,
): boolean {
  switch (filter) {
    case "All records":
      return true;
    case "Missing documentation":
      return row.missing !== null;
    case "Missing proof of payment":
      return row.missing === "proof" || row.missing === "both";
    case "Missing receipt/justification":
      return row.missing === "receipt" || row.missing === "both";
  }
}
