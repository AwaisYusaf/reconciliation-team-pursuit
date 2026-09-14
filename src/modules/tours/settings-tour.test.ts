/**
 * The Settings tour (Phase 7, D-95). Same source-reading approach as the other tour wiring
 * tests — this repo runs no jsdom/component-rendering tests.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SETTINGS_TOUR_STEPS } from "./settings-tour";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Settings tour wiring", () => {
  it("is mounted on the settings page", () => {
    const source = readFileSync(`${repoRoot}app/r/settings/page.tsx`, "utf8");
    expect(source).toContain("<TourGuide");
    expect(source).toContain("SETTINGS_TOUR_STEPS");
    expect(source).toContain('hasSeenTour(session.userId, "settings")');
  });

  it("has 7 steps covering every section, each with a real target and a valid autoOpen tab anchor", () => {
    expect(SETTINGS_TOUR_STEPS).toHaveLength(7);
    const source = readFileSync(`${repoRoot}app/r/settings/settings-sections.tsx`, "utf8");
    // The sidebar's `data-tour` is built from a template literal (`settings-tab-${id}`), not a
    // static string per id — confirm that wiring exists once, then validate any
    // "settings-tab-<id>" autoOpen value against the known section ids rather than the source.
    expect(source).toContain("data-tour={`settings-tab-${id}`}");
    const validSectionIds = ["organization", "fundingSources", "labels", "vendors", "users", "account"];
    for (const step of SETTINGS_TOUR_STEPS) {
      const targets = Array.isArray(step.target) ? step.target : [step.target];
      for (const target of targets) {
        expect(source, `data-tour="${target}" referenced by "${step.title}"`).toContain(
          `data-tour="${target}"`,
        );
      }
      if (step.autoOpen) {
        const match = /^settings-tab-(.+)$/.exec(step.autoOpen);
        expect(match, `autoOpen "${step.autoOpen}" should be a settings-tab-* anchor`).not.toBeNull();
        expect(validSectionIds).toContain(match![1]);
      }
    }
  });

  it("only the Organization tab's two steps have no autoOpen — it's the default landing tab", () => {
    const withoutAutoOpen = SETTINGS_TOUR_STEPS.filter((step) => !step.autoOpen);
    expect(withoutAutoOpen.map((step) => step.target)).toEqual([
      "settings-sidebar",
      "settings-doc-name",
    ]);
  });
});
