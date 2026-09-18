/**
 * Unit test for `summaryLinkNeedsSourceSwitch` (Phase 11 §7.5), plus a source-reading check of
 * `app/r/monthly-summary-ready-link.tsx` — this repo runs no jsdom/component-rendering tests
 * (`vitest.config.mts`: `environment: "node"`), so the client component's branching is checked
 * by reading its actual source, same convention as `packet-tour.test.ts`/`settings-tour.test.ts`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { summaryLinkNeedsSourceSwitch } from "./dashboard-link";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("summaryLinkNeedsSourceSwitch", () => {
  it("same source selected: no switch needed", () => {
    expect(summaryLinkNeedsSourceSwitch("source-1", "source-1")).toBe(false);
  });

  it("'All' selected (null): switch needed", () => {
    expect(summaryLinkNeedsSourceSwitch(null, "source-1")).toBe(true);
  });

  it("a different source selected: switch needed", () => {
    expect(summaryLinkNeedsSourceSwitch("source-2", "source-1")).toBe(true);
  });
});

describe("MonthlySummaryReadyLink wiring", () => {
  const source = readFileSync(`${repoRoot}app/r/monthly-summary-ready-link.tsx`, "utf8");

  it("only calls setActiveFundingSourceAction inside the branch where a switch is needed", () => {
    const branchStart = source.indexOf("if (!summaryLinkNeedsSourceSwitch(selectedId, sourceId))");
    const actionCall = source.indexOf("setActiveFundingSourceAction(sourceId)");
    expect(branchStart).toBeGreaterThan(-1);
    expect(actionCall).toBeGreaterThan(-1);
    // The action call must sit after the early-return branch closes, i.e. in the "needs switch"
    // path, not inside the plain-Link early return.
    const earlyReturnClose = source.indexOf("}", branchStart);
    expect(actionCall).toBeGreaterThan(earlyReturnClose);
  });

  it("pushes /r/monthly-summary only after reportResult(result) succeeds", () => {
    const reportCall = source.indexOf("if (!reportResult(result)) return;");
    const pushCall = source.indexOf('router.push("/r/monthly-summary")');
    expect(reportCall).toBeGreaterThan(-1);
    expect(pushCall).toBeGreaterThan(reportCall);
  });
});
