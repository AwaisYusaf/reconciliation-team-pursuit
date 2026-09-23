/**
 * The seam between the invoice reader's wire shape and the matcher's domain shape (Phase 14 §7).
 *
 * `read-invoice.ts`'s `InvoiceLine` and `invoice-match.ts`'s `InvoiceLine` are deliberately
 * different types (PHASE-14.md §7): the reader's line always carries real cents and a non-null
 * description (a line the strict decimal guard refuses is dropped, never kept as a zero), while
 * the matcher's line accepts nulls, because a person editing a row on the check screen can clear
 * a field. This file is the one place that converts one into the other, so nothing importing
 * either type can assume the two are interchangeable just because they share a name.
 *
 * Type-only import of the reader's type: erased at build time, so this module — imported by the
 * client check screen for its prefill — never pulls read-invoice.ts's `"server-only"` import
 * into the browser bundle.
 */
import type { InvoiceLine as MatchInvoiceLine } from "@/src/domain/invoice-match";
import type { InvoiceLine as ReadInvoiceLine } from "@/src/services/openai/read-invoice";

/** What `/api/files/read-invoice` sends over the wire for one line — the reader's own shape. */
export type WireInvoiceLine = ReadInvoiceLine;

/**
 * The reader has already collapsed "not printed" and "printed as $0.00" into the same 0 (see its
 * own `optionalCents`), so this conversion cannot recover a distinction the reader never kept —
 * it only adapts the shape, deliberately, in this one place.
 */
export function toMatchLine(line: WireInvoiceLine): MatchInvoiceLine {
  return {
    name: line.name,
    description: line.description,
    amountCents: line.subtotalCents,
    taxCents: line.taxCents,
    feesCents: line.feesCents,
  };
}
