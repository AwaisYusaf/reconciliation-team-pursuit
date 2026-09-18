/**
 * Unit tests for `aiCost` (Phase 11 follow-up, AI usage card). Covers the sub-cent 4dp branch,
 * the >= 1 cent `formatMoney` branch, and the exact 10,000 micro-USD boundary between them.
 */
import { describe, expect, it } from "vitest";

import { aiCost } from "./ai-cost";

describe("aiCost", () => {
  it("zero is the plain $0.00 formatMoney would give, not the 4dp form", () => {
    expect(aiCost(0)).toBe("$0.00");
  });

  it("a small sub-cent value renders to four decimal places", () => {
    // 1234 micro-USD = $0.001234 -> toFixed(4) = 0.0012, cleanly rounds with no float noise.
    expect(aiCost(1_234)).toBe("$0.0012");
  });

  it("just under the boundary (9,999 micro-USD) still uses the 4dp form", () => {
    expect(aiCost(9_999)).toBe("$0.0100"); // 0.009999 rounds up to 0.0100 at 4dp
  });

  it("exactly at the 10,000 micro-USD boundary switches to the cents/formatMoney form", () => {
    expect(aiCost(10_000)).toBe("$0.01");
  });

  it("just over the boundary (10,001 micro-USD) is in the formatMoney form", () => {
    expect(aiCost(10_001)).toBe("$0.01"); // rounds to the nearest cent
  });

  it("a large value goes through formatMoney with thousands separators", () => {
    // 1,234,567,000 micro-USD / 10,000 = 123,456.7 cents -> rounds to 123,457 cents = $1,234.57
    expect(aiCost(1_234_567_000)).toBe("$1,234.57");
  });
});
