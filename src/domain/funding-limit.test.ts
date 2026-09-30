/**
 * The funding limit (R9.6) as pure rules: the contract total it limits to (R7.3), how far a
 * source is over it, and which changes are refused (only the ones that leave it further over).
 * The actions that call these are proven against a real database in
 * `src/modules/line-items/funding-limit.integration.test.ts` and
 * `src/modules/funding-sources/funding-limit.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { fundingTotalCents, overLimitCents, raisesOverLimit, type FundingPosition } from "./funding-limit";
import { contractTotalCents } from "./summary";

const K = 100_000; // $1,000.00 in cents
const position = (contractValueCents: number, scheduledCents: number, newPerformanceCents = 0): FundingPosition => ({
  contractValueCents,
  scheduledCents,
  newPerformanceCents,
});

describe("contractTotalCents (R7.3, the one definition)", () => {
  it("is the contract value plus the new performances when a contract value is set", () => {
    expect(contractTotalCents({ contractValueCents: 150 * K, scheduledTotalCents: 999 * K, newPerformanceCents: 10 * K })).toBe(
      160 * K,
    );
  });

  it("falls back to the scheduled total when no contract value is set, ignoring new performances", () => {
    // The scheduled total already includes every performance, so adding them again would double count.
    expect(contractTotalCents({ contractValueCents: 0, scheduledTotalCents: 200 * K, newPerformanceCents: 10 * K })).toBe(
      200 * K,
    );
  });
});

describe("fundingTotalCents / overLimitCents", () => {
  it("contract value 0 means no limit: the total is the line items' own, never over", () => {
    expect(fundingTotalCents(position(0, 1_000_000 * K, 5 * K))).toBe(1_000_000 * K);
    expect(overLimitCents(position(0, 1_000_000 * K, 5 * K))).toBe(0);
  });

  it("equal is within the limit", () => {
    expect(overLimitCents(position(150 * K, 150 * K))).toBe(0);
  });

  it("one cent over is over by one cent", () => {
    expect(overLimitCents(position(150 * K, 150 * K + 1))).toBe(1);
  });

  it("counts new performances on the total side", () => {
    expect(fundingTotalCents(position(150 * K, 160 * K, 10 * K))).toBe(160 * K);
    expect(overLimitCents(position(150 * K, 160 * K, 10 * K))).toBe(0);
  });
});

describe("raisesOverLimit (refused only when further over)", () => {
  it("no contract value: nothing is ever a raise", () => {
    expect(raisesOverLimit(position(0, 0), position(0, 1_000_000 * K))).toBe(false);
  });

  it("up to exactly the limit is not a raise; one cent past it is", () => {
    expect(raisesOverLimit(position(150 * K, 100 * K), position(150 * K, 150 * K))).toBe(false);
    expect(raisesOverLimit(position(150 * K, 150 * K), position(150 * K, 150 * K + 1))).toBe(true);
  });

  it("a counted performance is neutral: it moves both sides equally", () => {
    expect(raisesOverLimit(position(150 * K, 150 * K, 0), position(150 * K, 160 * K, 10 * K))).toBe(false);
  });

  it("an already-over source may lower or leave unchanged; raising while over is refused", () => {
    const over = position(150 * K, 250 * K);
    expect(raisesOverLimit(over, position(150 * K, 240 * K))).toBe(false); // lower, still over
    expect(raisesOverLimit(over, position(150 * K, 250 * K))).toBe(false); // unchanged (rename, $0 add)
    expect(raisesOverLimit(over, position(150 * K, 250 * K + 1))).toBe(true);
  });

  it("a contract value cut below the line items is a raise; raising the value while over is not", () => {
    expect(raisesOverLimit(position(150 * K, 150 * K), position(150 * K - 1, 150 * K))).toBe(true);
    expect(raisesOverLimit(position(150 * K, 250 * K), position(200 * K, 250 * K))).toBe(false);
    expect(raisesOverLimit(position(150 * K, 250 * K), position(0, 250 * K))).toBe(false); // clearing removes the limit
  });
});
