/**
 * Recurring screen wiring (usability #43, #44), as source text: the repo has no render harness
 * (`vitest.config.mts`: `environment: "node"`). The action's half is proven against the database
 * in `add-to-month-result.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { sourceCode } from "@/src/lib/source-code.test-helper";

const manager = sourceCode("app/r/recurring/recurring-manager.tsx");

describe("recurring-manager.tsx", () => {
  it("AC11: 'Use the default' names the source from the same function the action uses", () => {
    expect(manager).toMatch(
      /\{currentDraft\.defaultPaymentSource === "" && \(\s*<Helper>The default is \{recurringPaymentSource\(null, paymentSources\)\}\.<\/Helper>/,
    );
    const action = sourceCode("src/modules/recurring/actions.ts");
    expect(action).toContain("recurringPaymentSource(item.defaultPaymentSource, activeSources)");
  });

  it("AC11: the page's list and the action's list come from the one reader, in the same order", () => {
    // Two reads with their own ORDER BY could disagree on a sort_order tie, and the hint would
    // then name a source the add does not pick. `activePaymentSources` breaks the tie by label
    // (proven in settings.integration.test.ts).
    const action = sourceCode("src/modules/recurring/actions.ts");
    expect(action).toContain("const activeSources = await activePaymentSources(current.orgId);");
    const page = sourceCode("app/r/recurring/page.tsx");
    expect(page).toMatch(/const \[items, options, activeSources, monthRows, lockedMonthKeys\] = await Promise\.all\(\[/);
    expect(page).toContain("activePaymentSources(session.orgId),");
    expect(page).toContain("paymentSources={activeSources}");
    for (const [file, code] of [["actions.ts", action], ["page.tsx", page]]) {
      expect(code, file).not.toMatch(/\.from\(paymentSources\)/);
    }
  });

  it("AC12: a successful add flashes, then toasts what the expense still needs with Open expense to its edit page", () => {
    const add = manager.slice(manager.indexOf("function add(row: RecurringRow) {"), manager.indexOf("function remove("));
    const refusal = add.indexOf("if (!result.ok) {");
    const flash = add.indexOf("flash(row.id)");
    expect(refusal).toBeGreaterThan(-1);
    // The flash waits for success (TASKS.md U2).
    expect(flash).toBeGreaterThan(add.indexOf("return;", refusal));
    expect(add).toContain("toastWithAction(UI.recurringAdded(row.name, monthLabel, result.data.missing), {");
    expect(add).toContain("label: UI.openExpense,");
    expect(add).toContain("onAction: () => router.push(`/r/expenses/${result.data.id}/edit`),");
    // A refusal is shown inline only, never toasted as well (PR #27).
    expect(add.slice(refusal, flash)).not.toContain("reportResult(");
    expect(add.slice(refusal, flash)).toContain("setError(result.error);");
  });
});
