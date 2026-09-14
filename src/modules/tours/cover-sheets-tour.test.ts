/**
 * The Cover Sheets tour (Phase 7, D-95). Same source-reading approach as the other tour wiring
 * tests — this repo runs no jsdom/component-rendering tests.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COVER_SHEETS_TOUR_STEPS } from "./cover-sheets-tour";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Cover Sheets tour wiring", () => {
  it("is mounted on the cover-sheets page, after the PickFundingSource branch", () => {
    const source = readFileSync(`${repoRoot}app/r/cover-sheets/page.tsx`, "utf8");
    const pickBranchStart = source.indexOf("fundingSourceId === null");
    const mainReturnStart = source.indexOf("<TourGuide");
    expect(pickBranchStart, "the PickFundingSource guard must exist").toBeGreaterThan(-1);
    expect(mainReturnStart, "<TourGuide must be mounted somewhere").toBeGreaterThan(-1);
    expect(mainReturnStart).toBeGreaterThan(pickBranchStart);
    expect(source).toContain("COVER_SHEETS_TOUR_STEPS");
    expect(source).toContain('hasSeenTour(session.userId, "cover_sheets")');
  });

  it("has exactly the 3 steps, each with a real target somewhere on the page", () => {
    expect(COVER_SHEETS_TOUR_STEPS).toHaveLength(3);
    const source = readFileSync(`${repoRoot}app/r/cover-sheets/page.tsx`, "utf8");
    for (const step of COVER_SHEETS_TOUR_STEPS) {
      const targets = Array.isArray(step.target) ? step.target : [step.target];
      for (const target of targets) {
        expect(source, `data-tour="${target}" referenced by "${step.title}"`).toContain(
          `data-tour="${target}"`,
        );
      }
    }
  });
});
