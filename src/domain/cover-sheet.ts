/**
 * Cover sheet composition (R6).
 *
 * Pure: decides what the sheet says, not how it is drawn. The docx generator, the packet's
 * PDF renderer and the on-screen preview all compose from here, so the three can never
 * disagree about which notes an expense carries or what its amount is.
 */
import { reimbursableCents } from "./money";
import { noReceiptNote, TAX_NOTE } from "./strings";

export type CoverSheetExpense = {
  name: string;
  description: string;
  subtotalCents: number;
  taxCents: number;
  feesCents: number;
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
 * A custom note never suppresses the tax note: the scope of work says the tax note is
 * always appended when tax was excluded, and both print when both apply (D-22).
 */
export function inlineNotes(expense: CoverSheetExpense): string[] {
  const notes: string[] = [];

  const custom = expense.note?.trim();
  if (custom) notes.push(custom);

  if (expense.taxCents > 0) notes.push(TAX_NOTE);

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
