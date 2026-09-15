/**
 * The Contract Summary tour (Phase 7, D-95). Same source-reading approach as the other tour
 * wiring tests — this repo runs no jsdom/component-rendering tests.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CONTRACT_SUMMARY_TOUR_STEPS } from "./contract-summary-tour";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Contract Summary tour wiring", () => {
  it("is mounted on the contract-summary page, after the PickFundingSource branch", () => {
    const source = readFileSync(`${repoRoot}app/r/contract-summary/page.tsx`, "utf8");
    const pickBranchStart = source.indexOf("fundingSourceId === null");
    const mainReturnStart = source.indexOf("<TourGuide");
    expect(pickBranchStart, "the PickFundingSource guard must exist").toBeGreaterThan(-1);
    expect(mainReturnStart, "<TourGuide must be mounted somewhere").toBeGreaterThan(-1);
    expect(mainReturnStart).toBeGreaterThan(pickBranchStart);
    expect(source).toContain("CONTRACT_SUMMARY_TOUR_STEPS");
    expect(source).toContain('hasSeenTour(session.userId, "contract_summary")');
  });

  it("has exactly the 2 steps, each with a real target on the page", () => {
    expect(CONTRACT_SUMMARY_TOUR_STEPS).toHaveLength(2);
    const source = readFileSync(`${repoRoot}app/r/contract-summary/page.tsx`, "utf8");
    for (const step of CONTRACT_SUMMARY_TOUR_STEPS) {
      const targets = Array.isArray(step.target) ? step.target : [step.target];
      for (const target of targets) {
        expect(source, `data-tour="${target}" referenced by "${step.title}"`).toContain(
          `data-tour="${target}"`,
        );
      }
    }
  });
});
