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

import { UI } from "@/src/domain/strings";

import { addExpenseTourSteps } from "./add-expense-tour";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Add Expense tour wiring", () => {
  it("is mounted on the new-expense page", () => {
    const source = readFileSync(`${repoRoot}app/r/expenses/new/page.tsx`, "utf8");
    // The JSX tag itself, not just the identifier — an unused `import { TourGuide }` would
    // still contain the bare word "TourGuide" with nothing actually rendered.
    expect(source).toContain("<TourGuide");
    expect(source).toContain("addExpenseTourSteps");
    expect(source).toContain('hasSeenTour(session.userId, "add_expense")');
  });

  it("is not mounted on the edit-expense page", () => {
    const source = readFileSync(`${repoRoot}app/r/expenses/[id]/edit/page.tsx`, "utf8");
    expect(source).not.toContain("<TourGuide");
    expect(source).not.toContain("addExpenseTourSteps");
  });

  it("has exactly the 6 steps the spec names, each with a real target in the form", () => {
    const steps = addExpenseTourSteps(false);
    expect(steps).toHaveLength(6);
    const formSource = readFileSync(`${repoRoot}src/modules/expenses/expense-form.tsx`, "utf8");
    for (const step of steps) {
      const targets = Array.isArray(step.target) ? step.target : [step.target];
      for (const target of targets) {
        expect(formSource, `data-tour="${target}" referenced by "${step.title}"`).toContain(
          `data-tour="${target}"`,
        );
      }
    }
  });
});

describe("Add Expense tour amounts step (Phase 10 §6, Appendix A)", () => {
  it("addExpenseTourSteps(true) uses the new reading-aware body, verbatim", () => {
    const steps = addExpenseTourSteps(true);
    const amountsStep = steps.find((s) => s.target === "add-expense-amounts")!;
    expect(amountsStep.body).toBe(
      "Enter the amounts from the receipt, or use the ones AI finds in the receipt you added above. If it includes tax or fees, you'll be asked whether the funder pays for them.",
    );
    expect(amountsStep.body).toBe(UI.tourAmountsBodyWithReading);
  });

  it("addExpenseTourSteps(false) keeps the old body, verbatim", () => {
    const steps = addExpenseTourSteps(false);
    const amountsStep = steps.find((s) => s.target === "add-expense-amounts")!;
    expect(amountsStep.body).toBe(
      "Enter the amounts from the receipt. If it includes tax or fees, you'll be asked whether the funder pays for them.",
    );
    expect(amountsStep.body).toBe(UI.tourAmountsBody);
  });

  it("without reading, the original order is kept", () => {
    expect(addExpenseTourSteps(false).map((s) => s.target)).toEqual([
      "add-expense-name",
      "add-expense-description",
      "add-expense-amounts",
      "add-expense-reimbursable",
      "add-expense-proof",
      "add-expense-receipt",
    ]);
  });

  it("with reading, documents come before amounts — the same order the Plus form renders them in", () => {
    expect(addExpenseTourSteps(true).map((s) => s.target)).toEqual([
      "add-expense-name",
      "add-expense-description",
      "add-expense-proof",
      "add-expense-receipt",
      "add-expense-amounts",
      "add-expense-reimbursable",
    ]);
    // The form really does render them in that order when reading is on.
    const form = readFileSync(`${repoRoot}src/modules/expenses/expense-form.tsx`, "utf8");
    const plusUploads = form.indexOf("{readAmounts && proofAndReceipt}");
    const amountsRow = form.indexOf('data-tour="add-expense-amounts"');
    const baseUploads = form.indexOf("{!readAmounts && proofAndReceipt}");
    expect(plusUploads).toBeGreaterThan(-1);
    expect(plusUploads).toBeLessThan(amountsRow);
    expect(baseUploads).toBeGreaterThan(amountsRow);
  });

  it("only the three AI-related bodies differ between the two versions", () => {
    const byTarget = (steps: readonly { target: unknown; body: string }[]) =>
      Object.fromEntries(steps.map((s) => [s.target as string, s.body]));
    const withReading = byTarget(addExpenseTourSteps(true));
    const without = byTarget(addExpenseTourSteps(false));
    const aiSteps = ["add-expense-amounts", "add-expense-proof", "add-expense-receipt"];
    for (const target of Object.keys(without)) {
      if (aiSteps.includes(target)) expect(withReading[target]).not.toBe(without[target]);
      else expect(withReading[target]).toBe(without[target]);
    }
  });
});

describe("Add Expense tour proof/receipt steps (Phase 10, Plus)", () => {
  const body = (readAmounts: boolean, target: string) =>
    addExpenseTourSteps(readAmounts).find((s) => s.target === target)!.body;

  it("without reading, both keep their pre-Phase-10 text verbatim", () => {
    expect(body(false, "add-expense-proof")).toBe(
      "Always required. Add a bank transaction or payment screenshot. Without it, the month's packet can't be downloaded.",
    );
    expect(body(false, "add-expense-receipt")).toBe(
      "Add the receipt, invoice or timesheet. If there isn't one, check No receipt available and give a reason. The reason prints on the cover sheet.",
    );
  });

  it("with reading, both say what AI does, and the receipt step says nothing fills in without Use these amounts", () => {
    expect(body(true, "add-expense-proof")).toContain("With Plus, AI reads the amount paid");
    expect(body(true, "add-expense-receipt")).toContain("With Plus, AI reads its amounts");
    expect(body(true, "add-expense-receipt")).toContain(`Nothing is filled in until you press ${UI.useTheseAmounts}`);
  });

  it("the receipt step keeps 'The reason prints on the cover sheet' on both versions (PR #18 review #14: the Plus variant had dropped it)", () => {
    expect(body(false, "add-expense-receipt")).toContain("The reason prints on the cover sheet.");
    expect(body(true, "add-expense-receipt")).toContain("The reason prints on the cover sheet.");
  });
});
