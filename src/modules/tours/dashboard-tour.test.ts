/**
 * The Dashboard tour (Phase 7, D-94). Same source-reading approach as the other tour wiring
 * tests — this repo runs no jsdom/component-rendering tests.
 *
 * This file exists because its absence was the reason a broken step shipped: every other tour
 * had a test asserting its targets were really anchored, the Dashboard did not, and its
 * "Add Expense" step spent that whole time pointing at a `data-tour` on the nav *wrapper* —
 * so the spotlight opened over the entire tab bar.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DASHBOARD_TOUR_STEPS } from "./dashboard-tour";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(`${repoRoot}${path}`, "utf8");

/** The two files that between them render every Dashboard target: the shell's month and
 *  funding-source selectors, and the dashboard section's own figures and actions. */
const TARGET_SOURCES = ["app/r/layout.tsx", "app/r/source-budget-section.tsx"];

describe("Dashboard tour wiring", () => {
  it("has exactly the 4 steps, each with a real target on the page", () => {
    expect(DASHBOARD_TOUR_STEPS).toHaveLength(4);
    const sources = TARGET_SOURCES.map(read).join("\n");
    for (const step of DASHBOARD_TOUR_STEPS) {
      const targets = Array.isArray(step.target) ? step.target : [step.target];
      for (const target of targets) {
        expect(sources, `data-tour="${target}" referenced by "${step.title}"`).toContain(
          `data-tour="${target}"`,
        );
      }
    }
  });

  it('anchors "Add Expense" on the dashboard button, not on the nav', () => {
    // The step describes adding an expense, so it has to point at the control that does that.
    // Anchored on the nav it pointed at nine tabs at once, and below `xl` the Add Expense tab
    // is inside a closed menu, so there was nothing meaningful to spotlight at any width.
    const addExpense = DASHBOARD_TOUR_STEPS.find((step) => step.title === "Add Expense");
    expect(addExpense?.target).toBe("dashboard-add-expense");
    expect(read("app/r/source-budget-section.tsx")).toContain(
      'data-tour="dashboard-add-expense"',
    );
  });

  it("leaves no tour anchor on the nav wrapper", () => {
    // The guard for the actual regression: any `data-tour` on `AppNav`'s outermost element is
    // a spotlight over the whole tab bar, whatever the key is called.
    expect(read("src/components/app-shell/app-nav.tsx")).not.toMatch(
      /return\s*\(\s*(?:\/\/[^\n]*\n\s*)*<div\s+data-tour=/,
    );
  });
});
