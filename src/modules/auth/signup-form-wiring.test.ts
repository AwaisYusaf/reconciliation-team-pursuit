/**
 * Sign-up page wiring (usability #1, #3), as source text: the repo has no render harness
 * (`vitest.config.mts`: `environment: "node"`). The action's half (#2) is proven against the
 * database in `signup-validation.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { sourceCode } from "@/src/lib/source-code.test-helper";

describe("each password field has its own Show toggle (#1, AC1, E34)", () => {
  const form = sourceCode("app/(auth)/signup/signup-form.tsx");

  /** The `<Input ... />` element carrying this id. */
  function inputWithId(id: string): string {
    const at = form.indexOf(`id="${id}"`);
    expect(at, id).toBeGreaterThan(-1);
    const start = form.lastIndexOf("<Input", at);
    return form.slice(start, form.indexOf("/>", at));
  }

  it("Password reads showPassword and Confirm password reads showConfirm, never a shared type", () => {
    expect(inputWithId("password")).toContain('type={showPassword ? "text" : "password"}');
    expect(inputWithId("confirmPassword")).toContain('type={showConfirm ? "text" : "password"}');
    expect(form).not.toContain("passwordType");
  });

  it("two separate flags, each toggled only by its own button", () => {
    expect(form).toContain("const [showPassword, setShowPassword] = useState(false);");
    expect(form).toContain("const [showConfirm, setShowConfirm] = useState(false);");
    const toggles = [...form.matchAll(/<ShowToggle\s+shown=\{(\w+)\}\s+onToggle=\{\(\) => (\w+)\(/g)].map((m) => [m[1], m[2]]);
    expect(toggles).toEqual([
      ["showPassword", "setShowPassword"],
      ["showConfirm", "setShowConfirm"],
    ]);
  });

  it("each toggle names its own field for screen readers", () => {
    expect(form).toMatch(/field="password"/);
    expect(form).toMatch(/field="confirm password"/);
    expect(form).toContain('<span className="sr-only"> {field}</span>');
    expect(form).toContain("aria-pressed={shown}");
  });
});

describe("the subtitle names the next step (#3, AC3, E31)", () => {
  const page = sourceCode("app/(auth)/signup/page.tsx");

  it("mentions a plan only while billing is on, and no longer promises recording expenses", () => {
    expect(page).toContain('import { billingEnabled } from "@/src/modules/billing/config";');
    expect(page).toMatch(
      /billingEnabled\(\)\s*\?\s*"A few details to start\. Next, you'll choose a plan and set up your budget\."\s*:\s*"A few details to start\. Next, you'll set up your budget\."/,
    );
    expect(page).not.toContain("start recording expenses");
  });
});
