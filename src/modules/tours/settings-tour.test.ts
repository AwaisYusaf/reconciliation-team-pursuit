/**
 * The Settings tour (Phase 7, D-95). Same source-reading approach as the other tour wiring
 * tests — this repo runs no jsdom/component-rendering tests.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SECTION_IDS } from "@/src/modules/settings/sections";

import { SETTINGS_TOUR_STEPS } from "./settings-tour";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Settings tour wiring", () => {
  it("is mounted on the settings page", () => {
    const source = readFileSync(`${repoRoot}app/r/settings/page.tsx`, "utf8");
    expect(source).toContain("<TourGuide");
    expect(source).toContain("SETTINGS_TOUR_STEPS");
    expect(source).toContain('hasSeenTour(session.userId, "settings")');
  });

  it("has 9 steps covering every section, each with a real target and a valid autoOpen tab anchor", () => {
    expect(SETTINGS_TOUR_STEPS).toHaveLength(9);
    // Plan & billing lives in its own component, so its target is looked for there too.
    const source =
      readFileSync(`${repoRoot}app/r/settings/settings-sections.tsx`, "utf8") +
      readFileSync(`${repoRoot}app/r/settings/plan-billing-section.tsx`, "utf8");
    // The sidebar's `data-tour` is built from a template literal (`settings-tab-${id}`), not a
    // static string per id — confirm that wiring exists once, then validate any
    // "settings-tab-<id>" autoOpen value against the known section ids rather than the source.
    expect(source).toContain("data-tour={`settings-tab-${id}`}");
    const validSectionIds: readonly string[] = SECTION_IDS;
    expect(new Set(SETTINGS_TOUR_STEPS.map((step) => step.autoOpen))).toEqual(
      new Set(SECTION_IDS.map((id) => `settings-tab-${id}`)),
    );
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

  it("every step names the section it belongs to, the two Organization ones included", () => {
    // The Organization steps used to rely on it being the tab Settings already lands on. That
    // only holds going forward: stepping Back from a later step left the page on whichever
    // section that step had switched to, so `settings-doc-name` was no longer in the DOM and
    // the step was dropped rather than shown. Every step now restores its own section, which
    // is what makes Back work in both directions (review fix).
    const withoutAutoOpen = SETTINGS_TOUR_STEPS.filter((step) => !step.autoOpen);
    expect(withoutAutoOpen).toEqual([]);

    expect(
      SETTINGS_TOUR_STEPS.filter((step) => step.autoOpen === "settings-tab-organization").map(
        (step) => step.target,
      ),
    ).toEqual(["settings-sidebar", "settings-doc-name", "settings-read-amounts"]);
  });

  it("the Plus reading step targets the switch wrapper, which only renders when the plan offers it", () => {
    const source = readFileSync(`${repoRoot}app/r/settings/settings-sections.tsx`, "utf8");
    // The target lives inside `{readAmounts && (…)}`, so a base-plan org has no such element and
    // the engine drops the step (resolve-steps.ts).
    const gate = source.indexOf("{readAmounts && (");
    const target = source.indexOf('data-tour="settings-read-amounts"');
    expect(gate).toBeGreaterThan(-1);
    expect(target).toBeGreaterThan(gate);
    expect(target - gate).toBeLessThan(200);
  });
});
