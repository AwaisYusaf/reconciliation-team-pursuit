/**
 * Structural wiring checks for the Monthly summary screen (Phase 11 §7.1, §7.5), in the repo's
 * source-reading style (`src/modules/tours/packet-tour.test.ts`) — this repo runs no
 * jsdom/component-rendering tests (`vitest.config.mts`: `environment: "node"`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function read(relPath: string): string {
  return readFileSync(`${repoRoot}${relPath}`, "utf8");
}

describe("Monthly summary page wiring", () => {
  it("uses loadMonthlySummaryScreen to load its data", () => {
    const source = read("app/r/monthly-summary/summary-section.tsx");
    expect(source).toContain("loadMonthlySummaryScreen");
  });

  it("keys the editor by both source and month, so switching either remounts it", () => {
    const source = read("app/r/monthly-summary/summary-section.tsx");
    expect(source).toMatch(/key=\{`\$\{fundingSourceId\}:\$\{month\}`\}/);
  });
});

describe("no dangerouslySetInnerHTML anywhere in the new screen or the packet section (P6)", () => {
  it.each([
    "app/r/monthly-summary/page.tsx",
    "app/r/monthly-summary/summary-section.tsx",
    "app/r/monthly-summary/summary-editor.tsx",
    // The rich editor — content always goes in as a JSON doc (`toEditorDoc`), never HTML.
    "app/r/monthly-summary/summary-rich-editor.tsx",
    "app/r/monthly-summary/use-autosave.ts",
    "app/r/monthly-summary/saved-summaries.tsx",
    "app/r/packet/page.tsx",
  ])("%s", (relPath) => {
    expect(read(relPath)).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("Word/PDF download wiring on the Monthly summary screen (Phase 4, P13)", () => {
  const source = read("app/r/monthly-summary/summary-editor.tsx");

  it("gates both DownloadButtons on downloadBlock, imported from the autosave module", () => {
    expect(source).toMatch(/import\s*\{[^}]*downloadBlock[^}]*\}\s*from\s*"@\/src\/modules\/monthly-summary\/autosave"/);
    expect(source).toContain("downloadBlock(snapshot)");
  });

  it("links both formats to /api/downloads/monthly-summary", () => {
    expect(source).toContain("/api/downloads/monthly-summary?source=");
    expect(source).toMatch(/format=docx/);
    expect(source).toMatch(/format=pdf/);
  });

  it("disables both DownloadButtons when blocked or while writing", () => {
    const matches = [...source.matchAll(/<DownloadButton[\s\S]*?disabled=\{([^}]+)\}/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const match of matches) {
      expect(match[1]).toContain("block !== null");
      expect(match[1]).toContain("writing");
    }
  });
});

describe("packet page wiring", () => {
  it("renders the Monthly summary section only after the fundingSourceId === null early return", () => {
    const source = read("app/r/packet/page.tsx");
    const pickBranchGuard = source.indexOf("fundingSourceId === null");
    const sectionMount = source.indexOf("<MonthlySummarySection");
    expect(pickBranchGuard, "the PickFundingSource guard must exist").toBeGreaterThan(-1);
    expect(sectionMount, "<MonthlySummarySection must be mounted somewhere").toBeGreaterThan(-1);
    expect(sectionMount).toBeGreaterThan(pickBranchGuard);
    // And not inside the early-return branch's own JSX.
    const pickBranchEnd = source.indexOf("PickFundingSource sources={activeSources} />");
    expect(sectionMount).toBeGreaterThan(pickBranchEnd);
  });
});

describe("Rich editor/skeleton wiring on the Monthly summary screen (PR #18 review #8)", () => {
  const source = read("app/r/monthly-summary/summary-editor.tsx");
  const editorSource = read("app/r/monthly-summary/summary-rich-editor.tsx");

  it("the toolbar has exactly Bold and Bullet list, and nothing else", () => {
    const buttons = [...editorSource.matchAll(/<ToolbarButton\s+label=\{UI\.(\w+)\}/g)].map((m) => m[1]);
    expect(buttons).toEqual(["summaryBold", "summaryBulletList"]);
  });

  it("the skeleton replaces the editor entirely while writing (not shown alongside it)", () => {
    const match = source.match(/\{writing \? \(\s*<SummarySkeleton \/>\s*\) : \(/);
    expect(match, "writing must branch to <SummarySkeleton /> in place of the rich editor").not.toBeNull();
  });

  it("Copy text is disabled while writing", () => {
    const match = source.match(/\{UI\.summaryCopyText\}/);
    expect(match).not.toBeNull();
    // The button just above the Copy text label must carry disabled={writing}.
    const copyButtonSource = source.slice(source.indexOf("void handleCopy") - 200, source.indexOf("void handleCopy"));
    expect(copyButtonSource).toMatch(/disabled=\{writing\}/);
  });

  it("summary-rich-editor.tsx is in the no-dangerouslySetInnerHTML guard list (the one file that renders the summary as an editable doc)", () => {
    // Read this file's own source rather than re-deriving the list, so the assertion fails if
    // the guard's `it.each` above ever drops the file rather than merely if the file is clean.
    const thisFile = readFileSync(fileURLToPath(new URL(import.meta.url)), "utf8");
    const guardListStart = thisFile.indexOf("no dangerouslySetInnerHTML anywhere");
    const guardListEnd = thisFile.indexOf("]", guardListStart);
    const guardList = thisFile.slice(guardListStart, guardListEnd);
    expect(guardList).toContain("app/r/monthly-summary/summary-rich-editor.tsx");
  });
});

describe("write route wiring", () => {
  it("the route calls sameOrigin before writeSummaryAction", () => {
    const source = read("app/api/monthly-summary/write/route.ts");
    const sameOriginCall = source.indexOf("sameOrigin(request)");
    const actionCall = source.indexOf("writeSummaryAction(");
    expect(sameOriginCall).toBeGreaterThan(-1);
    expect(actionCall).toBeGreaterThan(-1);
    expect(actionCall).toBeGreaterThan(sameOriginCall);
  });

  it("the client writes via fetch(\"/api/monthly-summary/write\"), not a direct writeSummaryAction import", () => {
    const source = read("app/r/monthly-summary/summary-editor.tsx");
    expect(source).toContain('fetch("/api/monthly-summary/write"');
    expect(source).not.toMatch(/import\s*\{[^}]*writeSummaryAction[^}]*\}/);
  });
});
