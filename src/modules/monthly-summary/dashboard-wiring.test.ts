/**
 * Source-reading checks that `app/r/page.tsx` batches `loadReadySummarySourceIds` once (no
 * N+1 from the Dashboard's own per-section rendering) and that `source-budget-section.tsx`
 * never queries it itself — same convention as `packet-tour.test.ts` (no jsdom in this repo).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Dashboard monthly-summary-ready wiring", () => {
  const pageSource = readFileSync(`${repoRoot}app/r/page.tsx`, "utf8");
  const sectionSource = readFileSync(`${repoRoot}app/r/source-budget-section.tsx`, "utf8");

  it("app/r/page.tsx calls loadReadySummarySourceIds exactly once", () => {
    const matches = pageSource.match(/loadReadySummarySourceIds\(/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("source-budget-section.tsx does not import monthly-summary queries or call the loader itself", () => {
    expect(sectionSource).not.toContain("loadReadySummarySourceIds");
    expect(sectionSource).not.toContain("modules/monthly-summary/queries");
  });

  it("the ready link is rendered only inside {summaryReady && (...)}", () => {
    const gate = sectionSource.indexOf("{summaryReady && (");
    const link = sectionSource.indexOf("<MonthlySummaryReadyLink");
    expect(gate).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(gate);
    // and it's the only place the link is rendered
    expect(sectionSource.match(/<MonthlySummaryReadyLink/g)).toHaveLength(1);
  });
});
