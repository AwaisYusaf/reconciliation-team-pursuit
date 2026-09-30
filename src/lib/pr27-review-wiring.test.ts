/**
 * PR #27 review, the screen-side fixes, as source text: the repo has no render harness
 * (`vitest.config.mts`: `environment: "node"`). The pure rules are tested beside their helpers
 * (`ungroupEdit` in money.test.ts, `invoiceDoneHref` in draft-rules.test.ts), the
 * onboarding row keys through the real action (onboarding.integration.test.ts), and the typed
 * edit of a prefilled money box in the browser.
 */
import { describe, expect, it } from "vitest";

import { between, sourceCode } from "./source-code.test-helper";

describe("#1 an edit to a grouped money box drops the grouping (money-input.tsx MoneyInput)", () => {
  it("is a Client Component of its own, re-exported from field.tsx, so field.tsx stays server-safe", () => {
    expect(sourceCode("src/components/ui/money-input.tsx").startsWith('"use client";')).toBe(true);
    expect(sourceCode("src/components/ui/field.tsx")).toContain('export { MoneyInput } from "./money-input";');
    expect(sourceCode("src/components/ui/field.tsx")).not.toMatch(/useRef|useLayoutEffect/);
  });

  const money = sourceCode("src/components/ui/money-input.tsx");

  it("every edit goes through ungroupEdit with the value from before it (the rule is tested in money.test.ts)", () => {
    const change = between(money, "onChange={(event) => {", "onChange?.(event);");
    expect(change).toMatch(/ungroupEdit\(\s*previous\.current,/);
    expect(change).toContain("input.value = next.value;");
    expect(change).toContain("previous.current = next.value;");
  });

  it("the value before an edit is refreshed after every render, so a fill into a focused box is covered", () => {
    expect(between(money, "useLayoutEffect(", "});")).toContain("previous.current = inputRef.current.value");
  });

  it("nothing changes on focus or select (a select-all must survive, PR #27)", () => {
    expect(money).not.toContain("onFocus");
  });
});

describe("#2 an invoice card says marked, not saved (expense-form.tsx)", () => {
  const form = sourceCode("src/modules/expenses/expense-form.tsx");

  it("each card branch toasts its own line right before handing the card back", () => {
    expect(form).toMatch(/toast\.success\(UI\.invoiceCardMarkedExpense\);\s*embedded\.onSaved\("expense"\);/);
    expect(form).toMatch(/toast\.success\(UI\.invoiceCardMarkedDraft\);\s*embedded\.onSaved\("draft"\);/);
    expect(form).not.toMatch(/toast\.success\(savedMessage\(\)\);\s*embedded\.onSaved/);
    expect(form).not.toMatch(/toast\.success\("Draft saved\."\);\s*embedded\.onSaved/);
  });
});

describe("#6 a refusal shown inline is not toasted as well", () => {
  /** The code of a handler from its opening line up to (not including) `end`. */
  function handler(file: string, start: string, end: string) {
    return between(sourceCode(file), start, end);
  }

  it("Line Items: save (run), reorder, delete, confirmed delete", () => {
    const file = "app/r/line-items/line-items-manager.tsx";
    const run = handler(file, "function run(", "function openManage(");
    expect(run).toMatch(/if \(!result\.ok\) \{[\s\S]*?showError\([\s\S]*?return;\s*\}\s*reportResult\(result, successMessage\);/);
    expect(between(run, "if (!result.ok) {", "return;")).not.toContain("reportResult");
    const move = handler(file, "function move(", "function remove(");
    expect(move).toMatch(/if \(result\.ok\) reportResult\(result, "Order updated\."\);\s*else setError\(result\.error \?\? "[^"]*"\);\s*router\.refresh\(\);/);
    const remove = handler(file, "function remove(", "return (");
    expect(between(remove, "if (!result.ok) {", "return;")).not.toContain("reportResult");
    expect(sourceCode(file)).toMatch(
      /if \(result\.ok\) \{\s*reportResult\(result, "Line item deleted\."\);\s*router\.refresh\(\);\s*\} else setError\(result\.error \?\? "[^"]*"\);/,
    );
  });

  it("Recurring: save (run), add to month, remove, confirmed remove", () => {
    const file = "app/r/recurring/recurring-manager.tsx";
    const run = handler(file, "function run(", "function flash(");
    expect(run).toMatch(/if \(!result\.ok\) \{[\s\S]*?showError\([\s\S]*?return;\s*\}\s*reportResult\(result, successMessage\);/);
    expect(between(run, "if (!result.ok) {", "return;")).not.toContain("reportResult");
    // The add's refusal is pinned in recurring-manager-wiring.test.ts (AC12).
    expect(between(handler(file, "function remove(", "return ("), "if (!result.ok) {", "return;")).not.toContain("reportResult");
    expect(sourceCode(file)).toMatch(
      /if \(result\.ok\) \{\s*reportResult\(result, "Removed from this month\."\);\s*router\.refresh\(\);\s*\} else setError\(result\.error \?\? "[^"]*"\);/,
    );
  });

  it("Recurring: the add/edit form's refusal shows in the form, for that draft only", () => {
    const file = "app/r/recurring/recurring-manager.tsx";
    const form = handler(file, "function renderDraftForm(", "\n  return (\n    <div>");
    expect(form).toMatch(/\{formError\?\.draft === currentDraft && \(\s*<DangerPanel tone="notice" className="mt-5">\s*\{formError\.message\}/);
    expect(form.match(/showFormError\(currentDraft\),/g)).toHaveLength(2);
    expect(handler(file, "function showFormError(", "function renderDraftForm(")).toContain(
      "setFormError(message ? { draft: currentDraft, message } : null)",
    );
  });

  it("Settings: the funding source form (its own inline error) and the password change", () => {
    const file = "app/r/settings/settings-sections.tsx";
    const run = handler(file, "  function run(", "const visibleSections");
    expect(run).toContain("refusalShownInline = false,");
    expect(run).toMatch(/if \(!result\.ok\) \{\s*if \(!refusalShownInline\) reportResult\(result\);\s*return;\s*\}/);
    expect(handler(file, "  function save() {", "const activeCount")).toMatch(
      /\(\) => setEditingId\(null\),\s*true,\s*\);/,
    );
    const password = handler(file, "const result = await changePasswordAction({", "setCurrent(\"\");");
    expect(password).toMatch(/if \(!result\.ok\) \{\s*setError\(result\.error\);\s*return;\s*\}\s*reportResult\(/);
  });

  it("the header pickers say a refusal once, as a toast (no room for a line on a phone)", () => {
    for (const file of [
      "src/components/app-shell/funding-source-selector.tsx",
      "src/components/app-shell/month-selector.tsx",
    ]) {
      const apply = handler(file, "function apply(", "return (");
      expect(apply, file).toMatch(/if \(!result\.ok\) \{\s*reportResult\(result\);\s*return;\s*\}/);
      expect(sourceCode(file), file).not.toMatch(/setError|\{error/);
    }
  });

  it("Recurring: the add/edit form is locked while saving, so its refusal lands on the draft that was sent", () => {
    const form = handler("app/r/recurring/recurring-manager.tsx", "function renderDraftForm(", "\n  return (\n    <div>");
    expect(form).toContain('<fieldset disabled={pending} className="contents">');
    expect(form.indexOf("<fieldset")).toBeLessThan(form.indexOf("{formError?.draft === currentDraft"));
    expect(form.indexOf("</fieldset>")).toBeGreaterThan(form.indexOf("Delete from list"));
  });

  it("a share link's password refusal: under the box when it is about the password, a toast otherwise", () => {
    const save = handler("app/r/packet/shared-links.tsx", "function save() {", "\n  return (");
    expect(save).toMatch(
      /if \(result\.ok\) \{\s*reportResult\(result, message\);\s*onDone\(\);\s*\} else if \(result\.fieldErrors\?\.password\) setError\(result\.fieldErrors\.password\);\s*else reportResult\(result\);/,
    );
  });

  it("a repeated refusal visibly comes back: the Settings forms clear their error before asking", () => {
    const file = "app/r/settings/settings-sections.tsx";
    expect(handler(file, "  function save() {", "const work =")).toContain("setFormError(null);");
    expect(sourceCode(file)).toMatch(/onClick=\{\(\) => \{\s*setError\(null\);\s*startTransition\(async \(\) => \{\s*const result = await changePasswordAction\(/);
  });

  it("the page-level panel on Line Items and Recurring scrolls into view, since there is no toast", () => {
    const surfaces = sourceCode("src/components/ui/surfaces.tsx");
    expect(surfaces).toContain('node?.scrollIntoView({ block: "nearest" });');
    expect(surfaces).toContain("ref={reveal ? scrollIntoViewOnShow : undefined}");
    expect(sourceCode("app/r/recurring/recurring-manager.tsx")).toContain(
      '<DangerPanel key={error} tone="notice" className="mb-4" reveal>',
    );
    expect(surfaces).toContain('reveal && "scroll-mt-24",');
    // The Manage popup's own panel scrolls too: a long performance list can push it off screen.
    expect(sourceCode("app/r/line-items/line-items-manager.tsx")).toContain(
      '<DangerPanel key={error} tone="notice" className="mt-4" reveal>',
    );
    // Not while Manage is open: its own panel shows the refusal, and the page behind stays put.
    expect(sourceCode("app/r/line-items/line-items-manager.tsx")).toContain(
      '<DangerPanel key={error} tone="notice" className="mb-4" reveal={managingId === null}>',
    );
  });
});

describe("#3, #7 one supplier for a field's invalid state (field.tsx)", () => {
  const field = sourceCode("src/components/ui/field.tsx");

  it("Field gives its control aria-invalid with the error, so the border turns red", () => {
    expect(field).toContain(
      'children({ id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true as const } : {}) })',
    );
    expect(field).toContain("aria-[invalid=true]:border-danger");
  });

  it("invalidProps and focusFirstInvalid are the shared helpers", () => {
    expect(field).toContain(
      'return error ? { "aria-invalid": true as const, "aria-describedby": errorId } : {};',
    );
    const focus = between(field, "export function focusFirstInvalid(", "export function Field(");
    expect(focus).toContain(`const first = root?.querySelector<HTMLElement>('[aria-invalid="true"]');`);
    expect(focus).toContain("first?.focus({ preventScroll: true });");
    expect(focus).toContain('first?.scrollIntoView({ block: "center" });');
  });

  it("Field honours a fixed id and renders labelAside beside its label (sign-up's Show toggles)", () => {
    expect(field).toContain("const id = fixedId ?? generatedId;");
    expect(between(field, "{labelAside ? (", ") : (")).toContain("{labelAside}");
  });

  it("onboarding step 1 uses Field and focuses its first marked field; no hand-written helpers left", () => {
    const funding = sourceCode("app/(auth)/onboarding/funding/funding-form.tsx");
    for (const id of ["fundingName", "contractValue", "contractStart", "contractEnd"]) {
      expect(funding).toMatch(new RegExp(`<Field\\s+id="${id}"[\\s\\S]*?error=\\{fieldErrors\\?\\.${id}\\}`));
    }
    expect(funding).toMatch(
      /useEffect\(\(\) => \{\s*if \(fieldErrors && Object\.keys\(fieldErrors\)\.length > 0\) focusFirstInvalid\(formRef\.current\);\s*\}, \[fieldErrors\]\);/,
    );
    expect(funding).toContain("<form ref={formRef} onSubmit={onSubmit}>");
    for (const id of ["fundingName", "contractValue", "contractStart", "contractEnd"]) {
      const at = funding.indexOf(`id="${id}"`);
      const field = funding.slice(at, funding.indexOf("</Field>", at));
      expect(field, id).toMatch(/\{\(props\) =>[\s\S]*<(Input|MoneyInput)\s+\{\.\.\.props\}/);
    }
    expect(funding).not.toContain("function invalid(");
    expect(funding).not.toContain("function errorFor(");
  });
});

describe("#7 reuse", () => {
  it("an attached file's page count is UI.pageCount", () => {
    expect(sourceCode("src/modules/expenses/upload-field.tsx")).toContain("{UI.pageCount(document.pageCount ?? 1)}");
  });

  it("every money box's prefill is formatMoneyInput", () => {
    expect(sourceCode("app/r/expenses/[id]/edit/page.tsx")).toContain("const toMoney = formatMoneyInput;");
    expect(sourceCode("app/r/recurring/page.tsx")).toContain('(cents === null ? "" : formatMoneyInput(cents))');
    expect(sourceCode("app/r/recurring/recurring-manager.tsx")).toContain("amount: formatMoneyInput(row.amountCents),");
    expect(sourceCode("app/r/settings/vendor-table.tsx")).toContain('(cents === null ? "" : formatMoneyInput(cents))');
    const form = sourceCode("src/modules/expenses/expense-form.tsx");
    expect(form).toContain("subtotal: formatMoneyInput(suggestion.subtotalCents),");
    expect(form).not.toMatch(/\/ 100\)\.toFixed\(2\)/);
  });

  it("the drafts card lives in its area folder", () => {
    expect(sourceCode("app/r/packet/page.tsx")).toContain(
      'import { DraftsWaitingCard } from "@/src/components/expense-imports/drafts-waiting-card";',
    );
  });
});
