/**
 * Cover sheet composition (R6).
 *
 * Pure: decides what the sheet says, not how it is drawn. The docx generator, the packet's
 * PDF renderer and the on-screen preview all compose from here, so the three can never
 * disagree about which notes an expense carries or what its amount is.
 */
import { excludedParts, reimbursableCents, type ExpenseComposition } from "./money";
import { exclusionNote, noReceiptNote } from "./strings";

export type CoverSheetExpense = ExpenseComposition & {
  name: string;
  description: string;
  note: string | null;
  narrative: string | null;
  noReceipt: boolean;
  noReceiptReason: string | null;
};

export type CoverSheetRow = {
  /** Table column 1, and the bold heading below the table — always the same string (R6.4). */
  name: string;
  /** Table column 2: the description, verbatim (R6.2). */
  role: string;
  /** Table column 3: reimbursable, so tax is excluded (R1.3, R6.2). */
  amountCents: number;
  /** Yellow-highlighted notes appended to the heading, in R6.5 order. */
  notes: string[];
  /** Plain paragraph under the heading, above the proofs (R6.6). */
  narrative: string | null;
};

/**
 * The inline notes for one expense, in the order R6.5 fixes.
 *
 * A custom note never suppresses the exclusion note: the scope of work says the disclosure is
 * always appended when part of the receipt was not reimbursed, and both print when both apply
 * (D-22, amended by D-67).
 */
export function inlineNotes(expense: CoverSheetExpense): string[] {
  const notes: string[] = [];

  const custom = expense.note?.trim();
  if (custom) notes.push(custom);

  // Named for what was actually excluded. Printing the tax wording whenever tax exists would
  // now be a false statement on a funder document, because tax can be reimbursed (D-67).
  const exclusion = exclusionNote(excludedParts(expense));
  if (exclusion) notes.push(exclusion);

  if (expense.noReceipt) {
    const reason = expense.noReceiptReason?.trim();
    // The reason is required whenever the flag is set (R4.2), enforced in the action and
    // by a check constraint; a missing one would mean a malformed row rather than a note
    // worth printing, so the disclosure is simply omitted rather than printed half-formed.
    if (reason) notes.push(noReceiptNote(reason));
  }

  return notes;
}

/** One table row plus everything printed beneath it (R6.2, R6.5, R6.6). */
export function coverSheetRow(expense: CoverSheetExpense): CoverSheetRow {
  return {
    name: expense.name,
    role: expense.description,
    amountCents: reimbursableCents(expense),
    notes: inlineNotes(expense),
    narrative: expense.narrative?.trim() || null,
  };
}

/** Every row for a line item, in entry order, with the total the sheet prints (R6.2). */
export function coverSheetRows(expenses: readonly CoverSheetExpense[]): {
  rows: CoverSheetRow[];
  totalCents: number;
} {
  const rows = expenses.map(coverSheetRow);
  return {
    rows,
    totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
  };
}
