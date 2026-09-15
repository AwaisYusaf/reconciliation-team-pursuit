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

  it("has exactly the 3 steps, each with a real target (or autoOpen anchor) in the table", () => {
    expect(EXPENSES_TOUR_STEPS).toHaveLength(3);
    const source = readFileSync(`${repoRoot}app/r/expenses/expenses-table.tsx`, "utf8");
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

  it("step 3 auto-opens the row menu and spotlights the opened panel, not the closed trigger", () => {
    const step = EXPENSES_TOUR_STEPS[2];
    expect(step.autoOpen).toBe("expenses-row-menu-trigger");
    expect(step.target).toBe("expenses-row-menu-panel");
  });
});
