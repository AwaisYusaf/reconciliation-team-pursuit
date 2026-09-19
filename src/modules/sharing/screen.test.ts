/**
 * Wiring of sharing on the Month-End Packet tab (PHASE-12 §7), in the repo's source-reading style
 * for screens (`monthly-summary/screen.test.ts`) — this repo runs no component-rendering tests.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relPath: string) => readFileSync(`${repoRoot}${relPath}`, "utf8");

const buttons = read("app/r/packet/packet-download-buttons.tsx");
const dialog = read("app/r/packet/share-link-dialog.tsx");
const box = read("app/r/packet/shared-links.tsx");

describe("the Share link button follows the download rules (Appendix A §1)", () => {
  it("sits in the download row, disabled by the red documentation panel", () => {
    const row = buttons.slice(buttons.indexOf('data-tour="packet-downloads"'), buttons.indexOf("<SharedLinksBox"));
    expect(row).toContain("{UI.shareButton}");
    const shareButton = row.slice(row.lastIndexOf("<button", row.indexOf("{UI.shareButton}")), row.indexOf("{UI.shareButton}"));
    // Blocked by the red panel, and by a cancelled plan (C4).
    expect(shareButton).toContain("disabled={shareBlocked}");
    expect(buttons).toMatch(/const shareBlocked = blocked \|\| orgCancelled;/);
  });

  it("opens the share dialog only through the deleted-items gate, like the downloads", () => {
    expect(buttons).toMatch(/gated\(\(confirmedDeletions\) => setShareDialog\(\{ confirmedDeletions \}\)\)/);
    expect(buttons).toMatch(/requestDownload[\s\S]*?gated\(/);
    // The gate's confirm button keeps the ticket's words, whatever it continues to.
    expect(buttons).toContain('label: "Continue to download"');
  });

  it("gates Update shared file the same way, and disables it while the red panel shows", () => {
    expect(buttons).toMatch(/onUpdate=\{\(link\) => gated\(\(confirmed\) => void updateSharedFile\(link, confirmed\)\)\}/);
    expect(box).toMatch(/disabled=\{updateBlocked \|\| updating\}/);
    expect(buttons).toMatch(/updateBlocked=\{shareBlocked\}/);
  });
});

describe("long builds go through the POST routes, not Server Actions (P12)", () => {
  it("creates and updates by fetch", () => {
    expect(dialog).toContain('"/api/shared-links/create"');
    expect(buttons).toContain('"/api/shared-links/update"');
    for (const source of [buttons, dialog, box]) {
      expect(source).not.toMatch(/import\s*\{[^}]*\b(createSharedLinkAction|updateSharedFileAction)\b[^}]*\}/);
    }
  });
});

describe("the password hash never reaches the browser (P5)", () => {
  it.each([
    "app/r/packet/packet-download-buttons.tsx",
    "app/r/packet/share-link-dialog.tsx",
    "app/r/packet/shared-links.tsx",
    "app/s/[token]/unlock-form.tsx",
    "app/s/[token]/unlock-answer.ts",
    "app/r/packet/share-choice.ts",
  ])("%s", (relPath) => {
    expect(read(relPath)).not.toContain("passwordHash");
  });
});

describe("Enter submits, as in any other form (review round)", () => {
  // Both password fields sit in a real <form> whose button is type="submit", so Enter in the field
  // creates the link or saves the password instead of doing nothing.
  it("the share dialog's create step is a form submitted by Create link", () => {
    const form = dialog.slice(dialog.indexOf("<form"), dialog.indexOf("</form>"));
    expect(form).toMatch(/onSubmit=\{\(event\) => \{\s*event\.preventDefault\(\);\s*if \(!busy && !existing\) void create\(\);/);
    expect(form).toContain("<PasswordFields");
    expect(form).toMatch(/<Button type="submit" disabled=\{busy\}>\s*\{busy \? buildingLabel\(kind\) : UI\.shareCreate\}/);
    // The already-shared row carries its own password form, and forms can't nest.
    expect(form).not.toContain("<SharedLinkRow");
    expect(dialog.slice(dialog.indexOf("</form>"))).toContain("<SharedLinkRow");
  });

  it("Change password is a form submitted by Save", () => {
    const editor = box.slice(box.indexOf("function PasswordEditor"));
    const form = editor.slice(editor.indexOf("<form"), editor.indexOf("</form>"));
    expect(form).toMatch(/onSubmit=\{\(event\) => \{\s*event\.preventDefault\(\);\s*if \(!saving && !unchanged\) save\(\);/);
    expect(form).toContain("<PasswordFields");
    expect(form).toMatch(/<Button type="submit" disabled=\{saving \|\| unchanged\}>/);
  });
});
