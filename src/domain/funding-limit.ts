/**
 * The funding limit (R9.6): a funding source's line items may not add up to more than its
 * contract total (R7.3).
 */
import { contractTotalCents } from "./summary";

export type FundingPosition = {
  /** 0 = no contract value set, which means no limit (the total is then the line items' own). */
  contractValueCents: number;
  /** Every line item's base value plus every performance (`loadLineItemBudgets`). */
  scheduledCents: number;
  /** The performances that count toward the contract total (D-82). */
  newPerformanceCents: number;
};

export function fundingTotalCents(p: FundingPosition): number {
  return contractTotalCents({
    contractValueCents: p.contractValueCents,
    scheduledTotalCents: p.scheduledCents,
    newPerformanceCents: p.newPerformanceCents,
  });
}

/** How far the line items are over the contract total; 0 when within it or when no contract
 *  value is set. */
export function overLimitCents(p: FundingPosition): number {
  return Math.max(0, p.scheduledCents - fundingTotalCents(p));
}

/**
 * A change is refused only when it leaves the line items further over the total than before:
 * a performance moves both sides equally so it never is, and an organisation already over
 * (from before R9.6) can still make any change that doesn't make it worse.
 */
export function raisesOverLimit(before: FundingPosition, after: FundingPosition): boolean {
  return overLimitCents(after) > overLimitCents(before);
}
