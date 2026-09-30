/**
 * Settings, Users wiring (usability #49, #50, #51), as source text: the repo has no render
 * harness (`vitest.config.mts`: `environment: "node"`). The action's half (the sign-in link) is
 * proven against the database in `users.integration.test.ts` (j).
 */
import { describe, expect, it } from "vitest";

import { sourceCode } from "@/src/lib/source-code.test-helper";

const manager = sourceCode("app/r/settings/users/users-manager.tsx");
const panel = manager.slice(
  manager.indexOf("function GeneratedPasswordPanel("),
  manager.indexOf("export function UsersManager("),
);

describe("users-manager.tsx", () => {
  it("AC13: one line under Add user says what a Manager cannot do", () => {
    expect(manager).toMatch(/Add\s*<\/Button>\s*<\/div>\s*<Helper>\{UI\.managerRoleHint\}<\/Helper>/);
  });

  it("AC14: the one-time password panel is neutral, not the danger panel", () => {
    expect(panel.length).toBeGreaterThan(0);
    expect(panel).not.toContain("DangerPanel");
    // The shared calm note, not a hand-copied look-alike (PR #27).
    expect(panel).toContain('<InfoNote role="status" className="mt-4 border border-line">');
    expect(panel).not.toContain("danger");
  });

  it("AC15: it shows the sign-in page and copies one sentence with both", () => {
    expect(panel).toContain("Sign-in page: {signInUrl}");
    expect(panel).toContain("navigator.clipboard.writeText(UI.newUserSignIn(signInUrl, password))");
    expect(panel).toContain('{copied ? "Copied" : "Copy both"}');
  });

  it("AC15: both the create and the reset hand the link to the panel", () => {
    const setters = [...manager.matchAll(/setShownPassword\(\{[\s\S]*?\}\)/g)].map((m) => m[0]);
    expect(setters).toHaveLength(2);
    for (const setter of setters) expect(setter).toContain("signInUrl: result.data.signInUrl");
    expect(manager).toContain("signInUrl={shownPassword.signInUrl}");
  });
});
