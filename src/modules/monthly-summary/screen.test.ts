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
    const source = read("app/r/monthly-summary/page.tsx");
    expect(source).toContain("loadMonthlySummaryScreen");
  });

  it("keys the editor by both source and month, so switching either remounts it", () => {
    const source = read("app/r/monthly-summary/page.tsx");
    expect(source).toMatch(/key=\{`\$\{fundingSourceId\}:\$\{month\}`\}/);
  });
});

describe("no dangerouslySetInnerHTML anywhere in the new screen or the packet card (P6)", () => {
  it.each([
    "app/r/monthly-summary/page.tsx",
    "app/r/monthly-summary/summary-editor.tsx",
    "app/r/monthly-summary/use-autosave.ts",
    "app/r/monthly-summary/saved-summaries.tsx",
    "app/r/packet/monthly-summary-card.tsx",
  ])("%s", (relPath) => {
    expect(read(relPath)).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("no download buttons/links on the Monthly summary screen (Phase 4 scope)", () => {
  it.each([
    "app/r/monthly-summary/page.tsx",
    "app/r/monthly-summary/summary-editor.tsx",
    "app/r/monthly-summary/saved-summaries.tsx",
  ])("%s", (relPath) => {
    const source = read(relPath).toLowerCase();
    expect(source).not.toContain("download");
  });
});

describe("packet page wiring", () => {
  it("renders MonthlySummaryCard only after the fundingSourceId === null early return", () => {
    const source = read("app/r/packet/page.tsx");
    const pickBranchGuard = source.indexOf("fundingSourceId === null");
    const cardMount = source.indexOf("<MonthlySummaryCard");
    expect(pickBranchGuard, "the PickFundingSource guard must exist").toBeGreaterThan(-1);
    expect(cardMount, "<MonthlySummaryCard must be mounted somewhere").toBeGreaterThan(-1);
    expect(cardMount).toBeGreaterThan(pickBranchGuard);
    // And not inside the early-return branch's own JSX.
    const pickBranchEnd = source.indexOf("PickFundingSource sources={activeSources} />");
    expect(cardMount).toBeGreaterThan(pickBranchEnd);
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
