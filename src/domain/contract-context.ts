/**
 * The contract context strip (R7.3).
 *
 * Pure, and shared by the m07 screen and the packet's summary page, so the two can never
 * print a different contract number or period for the same month.
 */
import { invoicePeriod, type MonthKey } from "./dates";
import { formatMoney } from "./format";

export type ContractContextInput = {
  contractNumber: string;
  basePoNumber: string;
  performancePoNumber: string;
  /** 0 → fall back to the sum of scheduled values (R7.3). */
  contractValueCents: number;
  scheduledTotalCents: number;
  /**
   * The slice of every line item's performance total that actually counts toward the contract
   * total (D-82) — added on top of `contractValueCents` when set. Never the migrated
   * Performance Grant or anything else that predates `counts_toward_contract_total`, since that
   * money was already folded into `contractValueCents` before it had a line item of its own.
   */
  newPerformanceCents: number;
};

export type ContextItem = {
  label: string;
  value: string;
  /**
   * The display form. Identifiers read as a noun followed by the number ("Contract 6007211"),
   * amounts and periods take a colon ("Contract total: $940,000.00") — the wording the m07
   * design fixed, kept here so the screen and the packet cannot drift apart.
   */
  text: string;
};

function identifier(label: string, value: string): ContextItem {
  return { label, value, text: `${label} ${value}` };
}

function measure(label: string, value: string): ContextItem {
  return { label, value, text: `${label}: ${value}` };
}

/**
 * The strip's items, with empty settings omitted (R7.3).
 *
 * The invoice period is always present because it is derived from the month rather than
 * configured, so a half-configured organisation still gets a meaningful strip.
 */
export function contractContextItems(
  input: ContractContextInput,
  month: MonthKey,
): ContextItem[] {
  const items: ContextItem[] = [];

  if (input.contractNumber.trim()) {
    items.push(identifier("Contract", input.contractNumber.trim()));
  }

  // Falls back to the scheduled total so the strip is useful before the contract value is
  // entered; suppressed entirely when there is no budget yet either. A configured contract
  // value only needs a *new* performance added on top (D-82), same read-side approach as
  // `contractTotalCents` in summary.ts — a migrated one is already inside it. The fallback
  // (`scheduledTotalCents`) already has every performance folded in either way.
  const totalCents =
    input.contractValueCents > 0
      ? input.contractValueCents + input.newPerformanceCents
      : input.scheduledTotalCents;
  if (totalCents > 0) {
    items.push(measure("Contract total", formatMoney(totalCents)));
  }

  if (input.basePoNumber.trim()) {
    items.push(identifier("Base PO", input.basePoNumber.trim()));
  }
  if (input.performancePoNumber.trim()) {
    items.push(identifier("Performance PO", input.performancePoNumber.trim()));
  }

  items.push(measure("Invoice period", invoicePeriod(month)));
  return items;
}

/** The same strip as one line, for the packet's summary page (R7.3). */
export function contractContextLine(
  input: ContractContextInput,
  month: MonthKey,
): string {
  return contractContextItems(input, month)
    .map((item) => item.text)
    .join("  |  ");
}
