/**
 * The Add Expense tour must run on the *new*-expense route only, never on edit (Phase 7,
 * D-94, product spec: "Show the tour only when adding a new expense, not when editing one").
 *
 * `ExpenseForm` renders on both routes with the same `data-tour` attributes present either
 * way, so that alone can't prove the distinction — the real guarantee is architectural:
 * `<TourGuide>` is mounted from the *page*, and only the new-expense page's tree includes it.
 * This repo runs no jsdom/component-rendering tests (`vitest.config.ts`: `environment: "node"`,
 * `include: ["src/**\/*.test.ts"]` only) — introducing that harness for one check would be a
 * bigger addition than the check itself, so this reads the actual page source instead, which
 * is exactly where the real invariant lives.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ADD_EXPENSE_TOUR_STEPS } from "./add-expense-tour";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Add Expense tour wiring", () => {
  it("is mounted on the new-expense page", () => {
    const source = readFileSync(`${repoRoot}app/r/expenses/new/page.tsx`, "utf8");
    // The JSX tag itself, not just the identifier — an unused `import { TourGuide }` would
    // still contain the bare word "TourGuide" with nothing actually rendered.
    expect(source).toContain("<TourGuide");
    expect(source).toContain("ADD_EXPENSE_TOUR_STEPS");
    expect(source).toContain('hasSeenTour(session.userId, "add_expense")');
  });

  it("is not mounted on the edit-expense page", () => {
    const source = readFileSync(`${repoRoot}app/r/expenses/[id]/edit/page.tsx`, "utf8");
    expect(source).not.toContain("<TourGuide");
    expect(source).not.toContain("ADD_EXPENSE_TOUR_STEPS");
  });

  it("has exactly the 6 steps the spec names, each with a real target in the form", () => {
    expect(ADD_EXPENSE_TOUR_STEPS).toHaveLength(6);
    const formSource = readFileSync(`${repoRoot}src/modules/expenses/expense-form.tsx`, "utf8");
    for (const step of ADD_EXPENSE_TOUR_STEPS) {
      const targets = Array.isArray(step.target) ? step.target : [step.target];
      for (const target of targets) {
        expect(formSource, `data-tour="${target}" referenced by "${step.title}"`).toContain(
          `data-tour="${target}"`,
        );
      }
    }
  });
});
