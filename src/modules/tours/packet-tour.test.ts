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

import { UI } from "@/src/domain/strings";
import { countResolvableAfter, resolveOneStep } from "./resolve-steps";
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

  it("has exactly the 5 spec steps plus the Phase 11 Monthly summary step (6 total), each with a real target somewhere in the packet screen", () => {
    expect(PACKET_TOUR_STEPS).toHaveLength(6);
    const pageSource = readFileSync(`${repoRoot}app/r/packet/page.tsx`, "utf8");
    const sources = [
      pageSource,
      readFileSync(`${repoRoot}app/r/packet/packet-download-buttons.tsx`, "utf8"),
      readFileSync(`${repoRoot}app/r/packet/submitted-marker.tsx`, "utf8"),
      // "packet-submit" moved here from submitted-marker.tsx once month locking (R10.7) gave
      // the packet screen its own submit/lock controls.
      readFileSync(`${repoRoot}app/r/packet/month-lock.tsx`, "utf8"),
    ].join("\n");
    for (const step of PACKET_TOUR_STEPS) {
      const targets = Array.isArray(step.target) ? step.target : [step.target];
      for (const target of targets) {
        if (target === "packet-monthly-summary") {
          // The packet page's own Monthly summary section wrapper writes this as a conditional
          // expression (`data-tour={summariesAccess.use ? "..." : undefined}`), not a plain
          // string attribute, so the plain `data-tour="..."` check below would never match it —
          // handled explicitly instead. Moved here from the now-deleted
          // `app/r/packet/monthly-summary-card.tsx` (PR #18 review #7: one section, one loader,
          // shared with the Monthly summary screen).
          expect(
            pageSource,
            `data-tour={summariesAccess.use ? "${target}" : undefined} on the packet page`,
          ).toContain(`data-tour={summariesAccess.use ? "${target}" : undefined}`);
          continue;
        }
        expect(sources, `data-tour="${target}" referenced by "${step.title}"`).toContain(
          `data-tour="${target}"`,
        );
      }
    }
  });

  it("the Monthly summary step is last, uses the Phase 11 UI strings, and only targets the packet page's section wrapper, which only carries data-tour on the Plus plan", () => {
    const last = PACKET_TOUR_STEPS[PACKET_TOUR_STEPS.length - 1];
    expect(last.target).toBe("packet-monthly-summary");
    expect(last.title).toBe(UI.tourSummaryCardTitle);
    expect(last.body).toBe(UI.tourSummaryCardBody);

    const pageSource = readFileSync(`${repoRoot}app/r/packet/page.tsx`, "utf8");
    // The wrapper only carries the target when `summariesAccess.use` is true — the base plan
    // renders no element with this data-tour at all, so the engine drops the step there
    // (resolve-steps.ts), same pattern as settings-tour.test.ts's Plus-reading-step gating check.
    expect(pageSource).toContain('data-tour={summariesAccess.use ? "packet-monthly-summary" : undefined}');
  });

  it("resolve-steps drops the Monthly summary step (and only that one) when every other packet target exists but this one doesn't — e.g. the base plan", () => {
    const everyOtherTarget = new Set(
      PACKET_TOUR_STEPS.filter((step) => step.target !== "packet-monthly-summary").map(
        (step) => step.target as string,
      ),
    );
    const find = (key: string) => (everyOtherTarget.has(key) ? {} : null);

    const lastIndex = PACKET_TOUR_STEPS.length - 1;
    expect(resolveOneStep(PACKET_TOUR_STEPS[lastIndex], find)).toBeNull();
    for (let i = 0; i < lastIndex; i += 1) {
      expect(resolveOneStep(PACKET_TOUR_STEPS[i], find)).not.toBeNull();
    }
    // Counting from before the first step: every step but the dropped last one is resolvable.
    expect(countResolvableAfter(PACKET_TOUR_STEPS, -1, find)).toBe(lastIndex);
  });
});
