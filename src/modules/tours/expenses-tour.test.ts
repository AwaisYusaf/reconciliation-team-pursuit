/**
 * The Expenses tour (Phase 7, D-95) — mounted on the list page, with real `data-tour` targets
 * in the table component. Same source-reading approach as `add-expense-tour.test.ts`/
 * `packet-tour.test.ts`: this repo runs no jsdom/component-rendering tests.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EXPENSES_TOUR_STEPS } from "./expenses-tour";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Expenses tour wiring", () => {
  it("is mounted on the expenses list page", () => {
    const source = readFileSync(`${repoRoot}app/r/expenses/page.tsx`, "utf8");
    expect(source).toContain("<TourGuide");
    expect(source).toContain("EXPENSES_TOUR_STEPS");
    expect(source).toContain('hasSeenTour(session.userId, "expenses")');
  });

  it("has exactly the 4 steps, each with a real target (or autoOpen anchor) on the screen", () => {
    expect(EXPENSES_TOUR_STEPS).toHaveLength(4);
    // Both files: the drafts step (Phase 14) points at the toolbar button, which the page
    // itself renders, while the other three point into the table component.
    const source =
      readFileSync(`${repoRoot}app/r/expenses/expenses-table.tsx`, "utf8") +
      readFileSync(`${repoRoot}app/r/expenses/page.tsx`, "utf8");
    // A key can be anchored either as a literal `data-tour="key"` attribute, or — for `Menu`'s
    // trigger/panel, which take it as a prop and forward it internally (`menu.tsx`) — as
    // `triggerDataTour="key"` / `panelDataTour="key"`.
    const hasAnchor = (key: string) =>
      source.includes(`data-tour="${key}"`) || source.includes(`DataTour="${key}"`);
    for (const step of EXPENSES_TOUR_STEPS) {
      const targets = Array.isArray(step.target) ? step.target : [step.target];
      for (const target of targets) {
        expect(hasAnchor(target), `"${target}" referenced by "${step.title}"`).toBe(true);
      }
      if (step.autoOpen) {
        expect(hasAnchor(step.autoOpen), `autoOpen "${step.autoOpen}" on "${step.title}"`).toBe(
          true,
        );
      }
    }
  });

  it("the row-menu step auto-opens the menu and spotlights the opened panel, not the closed trigger", () => {
    // Found by target rather than by index: a step added anywhere before it (the Phase 14
    // drafts step was) must not turn this into an assertion about a different step.
    const step = EXPENSES_TOUR_STEPS.find((each) => each.target === "expenses-row-menu-panel");
    expect(step).toBeDefined();
    expect(step!.autoOpen).toBe("expenses-row-menu-trigger");
  });

  it("the drafts step comes before the row steps, where the button it points at sits", () => {
    const drafts = EXPENSES_TOUR_STEPS.findIndex(
      (each) => each.target === "expenses-drafts-toggle",
    );
    const rowMenu = EXPENSES_TOUR_STEPS.findIndex(
      (each) => each.target === "expenses-row-menu-panel",
    );
    expect(drafts).toBeGreaterThan(-1);
    expect(drafts).toBeLessThan(rowMenu);
  });
});
