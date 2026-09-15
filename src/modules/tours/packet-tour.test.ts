/**
 * The Month-End Packet tour must not start while "All funding sources" is selected — the spec:
 * "Don't start the tour until a source is chosen." `app/r/packet/page.tsx` handles this by
 * returning the `PickFundingSource` branch before any tour code runs, rather than mounting the
 * tour and having it decide not to show itself.
 *
 * Same reasoning as `add-expense-tour.test.ts`: this repo runs no jsdom/component-rendering
 * tests (`vitest.config.ts`: `environment: "node"`), so this reads the actual page source
 * rather than rendering it, checking the real invariant — where `<TourGuide` sits relative to
 * the early `PickFundingSource` return — instead of adding a harness for one check.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PACKET_TOUR_STEPS } from "./packet-tour";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Month-End Packet tour wiring", () => {
  it("is not reachable from the PickFundingSource (All-sources) branch", () => {
    const source = readFileSync(`${repoRoot}app/r/packet/page.tsx`, "utf8");
    const pickBranchStart = source.indexOf("fundingSourceId === null");
    const mainReturnStart = source.indexOf("<TourGuide");
    expect(pickBranchStart, "the PickFundingSource guard must exist").toBeGreaterThan(-1);
    expect(mainReturnStart, "<TourGuide must be mounted somewhere").toBeGreaterThan(-1);
    // The tour mount must appear textually after the guard — i.e. only reachable once that
    // branch has already returned, never inside it.
    expect(mainReturnStart).toBeGreaterThan(pickBranchStart);
    // And it isn't inside the PickFundingSource branch's own JSX either.
    const pickBranchEnd = source.indexOf("PickFundingSource sources={activeSources} />");
    expect(mainReturnStart).toBeGreaterThan(pickBranchEnd);
  });

  it("has exactly the 5 steps the spec names, each with a real target somewhere in the packet screen", () => {
    expect(PACKET_TOUR_STEPS).toHaveLength(5);
    const sources = [
      readFileSync(`${repoRoot}app/r/packet/page.tsx`, "utf8"),
      readFileSync(`${repoRoot}app/r/packet/packet-download-buttons.tsx`, "utf8"),
      readFileSync(`${repoRoot}app/r/packet/submitted-marker.tsx`, "utf8"),
      // "packet-submit" moved here from submitted-marker.tsx once month locking (R10.7) gave
      // the packet screen its own submit/lock controls.
      readFileSync(`${repoRoot}app/r/packet/month-lock.tsx`, "utf8"),
    ].join("\n");
    for (const step of PACKET_TOUR_STEPS) {
      const targets = Array.isArray(step.target) ? step.target : [step.target];
      for (const target of targets) {
        expect(sources, `data-tour="${target}" referenced by "${step.title}"`).toContain(
          `data-tour="${target}"`,
        );
      }
    }
  });
});
