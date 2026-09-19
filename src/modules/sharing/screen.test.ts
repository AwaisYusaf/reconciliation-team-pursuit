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
    expect(shareButton).toContain("disabled={blocked}");
  });

  it("opens the share dialog only through the deleted-items gate, like the downloads", () => {
    expect(buttons).toMatch(/gated\(\(confirmedDeletions\) => setShareDialog\(\{ confirmedDeletions \}\)\)/);
    expect(buttons).toMatch(/requestDownload[\s\S]*?gated\(/);
    // The gate's confirm button keeps the ticket's words, whatever it continues to.
    expect(buttons).toContain('label: "Continue to download"');
  });

  it("gates Update shared file the same way, and disables it while the red panel shows", () => {
    expect(buttons).toMatch(/onUpdate=\{\(link\) => gated\(\(confirmed\) => void updateSharedFile\(link, confirmed\)\)\}/);
    expect(box).toMatch(/disabled=\{blocked \|\| updating\}/);
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
  ])("%s", (relPath) => {
    expect(read(relPath)).not.toContain("passwordHash");
  });
});
