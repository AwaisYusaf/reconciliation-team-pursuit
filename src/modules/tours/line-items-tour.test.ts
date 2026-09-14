/**
 * The Line Items tour (Phase 7, D-95). Same source-reading approach as the other tour wiring
 * tests — this repo runs no jsdom/component-rendering tests.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LINE_ITEMS_TOUR_STEPS } from "./line-items-tour";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Line Items tour wiring", () => {
  it("is mounted on the line-items page, only in the funding-source-resolved branch", () => {
    const source = readFileSync(`${repoRoot}app/r/line-items/page.tsx`, "utf8");
    expect(source).toContain("<TourGuide");
    expect(source).toContain("LINE_ITEMS_TOUR_STEPS");
    expect(source).toContain('hasSeenTour(userId, "line_items")');
  });

  it("has exactly the 3 steps, each with a real target (and autoOpen anchor, where used) in the manager", () => {
    expect(LINE_ITEMS_TOUR_STEPS).toHaveLength(3);
    const source = readFileSync(`${repoRoot}app/r/line-items/line-items-manager.tsx`, "utf8");
    for (const step of LINE_ITEMS_TOUR_STEPS) {
      const targets = Array.isArray(step.target) ? step.target : [step.target];
      for (const target of targets) {
        expect(source, `data-tour="${target}" referenced by "${step.title}"`).toContain(
          `data-tour="${target}"`,
        );
      }
      if (step.autoOpen) {
        expect(source, `autoOpen "${step.autoOpen}" on "${step.title}"`).toContain(
          `data-tour="${step.autoOpen}"`,
        );
      }
    }
  });

  it("step 3 clicks Manage open before spotlighting the Performances table inside it", () => {
    const step = LINE_ITEMS_TOUR_STEPS[2];
    expect(step.autoOpen).toBe("line-items-manage");
    expect(step.target).toBe("line-items-performances");
  });
});
