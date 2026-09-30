/**
 * `TOUR_SEQUENCE`/`nextInSequence` (Phase 7, D-95) — the walkthrough order the auto-advancing
 * guided tour follows. Pure logic, extracted from `tour.tsx` the same way `resolve-steps.ts`
 * was, so it's testable without a jsdom harness this repo doesn't have.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { tourKey } from "@/src/db/schema";

import {
  continueTourSequence,
  endTourSequence,
  nextInSequence,
  settleTourSequenceOnMount,
  startsWalkthrough,
  startTourSequence,
  TOUR_SEQUENCE,
  TOUR_SEQUENCE_KEY,
} from "./sequence";

describe("TOUR_SEQUENCE", () => {
  it("has exactly one entry per TourKey enum value — no drift between schema and sequence", () => {
    const sequenceTours = TOUR_SEQUENCE.map((entry) => entry.tour).sort();
    const enumValues = [...tourKey.enumValues].sort();
    expect(sequenceTours).toEqual(enumValues);
  });

  it("has no duplicate hrefs", () => {
    const hrefs = TOUR_SEQUENCE.map((entry) => entry.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("starts at the Dashboard — two places depend on it being first", () => {
    // `tour.tsx` offers "Continue the tour" (the one control that starts the walkthrough) only
    // on the *Dashboard* tour's last card (usability #57), and Settings' "Show the app guide
    // again" sends the user to `TOUR_SEQUENCE[0]` to restart the guide from the beginning.
    // Reordering this list without moving the Dashboard back to the front would quietly break
    // both.
    expect(TOUR_SEQUENCE[0]).toEqual({ tour: "dashboard", href: "/r" });
  });
});

describe("nextInSequence", () => {
  it("walks from Dashboard to Add Expense — the auto-advance chain's first hop", () => {
    expect(nextInSequence("dashboard")).toEqual({ tour: "add_expense", href: "/r/expenses/new" });
  });

  it("returns undefined at the end of the list, ending the guided walkthrough quietly", () => {
    const last = TOUR_SEQUENCE[TOUR_SEQUENCE.length - 1].tour;
    expect(nextInSequence(last)).toBeUndefined();
  });

  it("returns the immediate successor for every non-last entry", () => {
    for (let i = 0; i < TOUR_SEQUENCE.length - 1; i++) {
      expect(nextInSequence(TOUR_SEQUENCE[i].tour)).toEqual(TOUR_SEQUENCE[i + 1]);
    }
  });
});

describe("the walkthrough flag", () => {
  const store = new Map<string, string>();

  function stubStorage() {
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  }

  function stubRouter() {
    return { push: vi.fn(), refresh: vi.fn() };
  }

  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  describe("continueTourSequence", () => {
    it("hands on to the next tab and records that as where the walkthrough now is", () => {
      stubStorage();
      store.set(TOUR_SEQUENCE_KEY, "dashboard");
      const router = stubRouter();

      continueTourSequence("dashboard", router);

      expect(router.push).toHaveBeenCalledWith("/r/expenses/new");
      // Paired with the push so the next tab can't be served a prefetched, stale `alreadySeen`.
      expect(router.refresh).toHaveBeenCalled();
      expect(store.get(TOUR_SEQUENCE_KEY)).toBe("add_expense");
    });

    it("carries on past a 'choose a source' screen", () => {
      stubStorage();
      store.set(TOUR_SEQUENCE_KEY, "cover_sheets");
      const router = stubRouter();

      continueTourSequence("cover_sheets", router);

      expect(router.push).toHaveBeenCalledWith("/r/recurring");
    });

    it("never navigates on a leftover flag for a different tab, and clears it", () => {
      // The reported bug. A walkthrough stopped at Line Items left its flag behind; much later
      // an ordinary visit to Packet with "All" selected read it and sent the user to Contract
      // Summary. With the old bare "1" flag this call navigated.
      stubStorage();
      store.set(TOUR_SEQUENCE_KEY, "line_items");
      const router = stubRouter();

      continueTourSequence("packet", router);

      expect(router.push).not.toHaveBeenCalled();
      expect(store.has(TOUR_SEQUENCE_KEY)).toBe(false);
    });

    it("does nothing when no walkthrough is running", () => {
      stubStorage();
      const router = stubRouter();

      continueTourSequence("dashboard", router);

      expect(router.push).not.toHaveBeenCalled();
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it("ends the walkthrough at the last tab instead of navigating", () => {
      stubStorage();
      const last = TOUR_SEQUENCE[TOUR_SEQUENCE.length - 1].tour;
      store.set(TOUR_SEQUENCE_KEY, last);
      const router = stubRouter();

      continueTourSequence(last, router);

      expect(router.push).not.toHaveBeenCalled();
      expect(store.has(TOUR_SEQUENCE_KEY)).toBe(false);
    });

    it("treats unavailable storage as no walkthrough rather than throwing", () => {
      // Private browsing, or storage blocked by policy.
      vi.stubGlobal("sessionStorage", {
        getItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {},
        setItem: () => {},
      });
      const router = stubRouter();

      expect(() => continueTourSequence("dashboard", router)).not.toThrow();
      expect(router.push).not.toHaveBeenCalled();
    });
  });

  describe("settleTourSequenceOnMount", () => {
    it("ends the walkthrough when it reaches a tab whose tour was already seen", () => {
      // The other way the flag used to get stuck: that tab's tour never starts, so nothing
      // ever carried the walkthrough on or cleared it.
      stubStorage();
      store.set(TOUR_SEQUENCE_KEY, "recurring");

      settleTourSequenceOnMount("recurring", false);

      expect(store.has(TOUR_SEQUENCE_KEY)).toBe(false);
    });

    it("keeps a walkthrough that has arrived at this tab in turn", () => {
      stubStorage();
      store.set(TOUR_SEQUENCE_KEY, "packet");

      settleTourSequenceOnMount("packet", true);

      expect(store.get(TOUR_SEQUENCE_KEY)).toBe("packet");
    });

    it("clears a walkthrough recorded as being on some other tab", () => {
      stubStorage();
      store.set(TOUR_SEQUENCE_KEY, "packet");

      settleTourSequenceOnMount("expenses", true);

      expect(store.has(TOUR_SEQUENCE_KEY)).toBe(false);
    });

    it("leaves things alone when no walkthrough is running", () => {
      stubStorage();

      settleTourSequenceOnMount("dashboard", true);

      expect(store.has(TOUR_SEQUENCE_KEY)).toBe(false);
    });
  });

  it("startTourSequence begins at the first tab; endTourSequence clears it", () => {
    stubStorage();

    startTourSequence();
    expect(store.get(TOUR_SEQUENCE_KEY)).toBe("dashboard");

    endTourSequence();
    expect(store.has(TOUR_SEQUENCE_KEY)).toBe(false);
  });
});

describe("startsWalkthrough", () => {
  it("is offered by the Dashboard tour's first run", () => {
    expect(startsWalkthrough("dashboard", { replay: false })).toBe(true);
  });

  it("is not offered on a replay of the Dashboard tour", () => {
    // The reported bug: (i) on the Dashboard reset the tour's "shown anything yet" state, so a
    // replay looked like a first run and Done carried the user off to Add Expense.
    expect(startsWalkthrough("dashboard", { replay: true })).toBe(false);
  });

  it("is not offered by any other tab's tour", () => {
    expect(startsWalkthrough("packet", { replay: false })).toBe(false);
  });

  it("is offered again after Settings' 'Show the app guide again', which lands on TOUR_SEQUENCE[0] as a first run (E19)", () => {
    // The reset clears the seen flags and pushes to the first tab. It never fires the replay
    // event, the one thing that marks a run as a replay (`replayRef` in tour.tsx), so the
    // Dashboard tour it lands on is a first run and offers Continue the tour.
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const settings = readFileSync(`${root}app/r/settings/settings-sections.tsx`, "utf8");
    expect(settings).toMatch(
      /\(\) => resetToursAction\(\),[\s\S]{0,900}?\(\) => router\.push\(TOUR_SEQUENCE\[0\]\.href\),/,
    );
    expect(settings).not.toContain("TOUR_REPLAY_EVENT");
    expect(startsWalkthrough(TOUR_SEQUENCE[0].tour, { replay: false })).toBe(true);
  });

  it("is offered by no tour other than the Dashboard's, first run or replay", () => {
    for (const { tour } of TOUR_SEQUENCE.slice(1)) {
      expect(startsWalkthrough(tour, { replay: false }), tour).toBe(false);
      expect(startsWalkthrough(tour, { replay: true }), tour).toBe(false);
    }
  });
});

/**
 * `tour.tsx` wiring for usability #57, read from source (this repo has no jsdom; the same style
 * as `tour-dismiss.test.ts`). Done must never start the walkthrough: only the last card's
 * "Continue the tour" does, and only when `startsWalkthrough` said so.
 */
describe("tour.tsx: the walkthrough starts only from Continue the tour (usability #57)", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const source = readFileSync(`${repoRoot}src/components/ui/tour.tsx`, "utf8");
  /** The source with comments removed, so a sentence mentioning a call can't satisfy a check. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("calls startTourSequence() exactly once, inside the Continue button's handler", () => {
    const calls = [...code.matchAll(/startTourSequence\(\)/g)];
    expect(calls).toHaveLength(1);
    const handler = code.match(
      /\{isLast && offerWalkthrough && \(\s*<Button[\s\S]*?onClick=\{\(\) => \{\s*startTourSequence\(\);\s*finish\(false\);\s*\}\}[\s\S]*?\{UI\.tourContinueButton\}/,
    );
    expect(handler, "Continue must be gated on isLast && offerWalkthrough and start then finish").not.toBeNull();
  });

  it("the per-step resolver only records the offer, it never starts the walkthrough", () => {
    const start = code.indexOf("const el = resolveOneStep(step, findByDataTour);");
    const end = code.indexOf("setCurrent({ el, step });", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const resolver = code.slice(start, end);
    expect(resolver).toContain("setOfferWalkthrough(startsWalkthrough(tour, { replay: replayRef.current }));");
    expect(resolver).not.toContain("startTourSequence");
  });

  it("Skip reads 'Skip all tours' only on the card that offers the walkthrough, and still skips everything", () => {
    expect(code).toMatch(
      /<Button variant="quiet" onClick=\{\(\) => finish\(true\)\}>\s*\{isLast && offerWalkthrough \? UI\.tourSkipAllButton : "Skip"\}\s*<\/Button>/,
    );
  });

  it("Done stays the primary button with the focus ref, and finish(false) does not start anything", () => {
    expect(code).toMatch(/ref=\{primaryRef\}\s*onClick=\{\(\) => \(isLast \? finish\(false\) : setStepIndex\(\(i\) => i \+ 1\)\)\}/);
    const finishStart = code.indexOf("function finish(skipped: boolean) {");
    const finishEnd = code.indexOf("function goBack()", finishStart);
    expect(finishStart).toBeGreaterThan(-1);
    const finishBody = code.slice(finishStart, finishEnd);
    expect(finishBody).not.toContain("startTourSequence");
    // Carrying on is only for a walkthrough already running (unchanged behaviour).
    expect(finishBody).toContain("continueTourSequence(tour, router);");
  });
});
