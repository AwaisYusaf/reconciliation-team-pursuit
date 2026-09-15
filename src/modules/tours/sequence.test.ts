/**
 * `TOUR_SEQUENCE`/`nextInSequence` (Phase 7, D-95) — the walkthrough order the auto-advancing
 * guided tour follows. Pure logic, extracted from `tour.tsx` the same way `resolve-steps.ts`
 * was, so it's testable without a jsdom harness this repo doesn't have.
 */
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
    // `tour.tsx` arms the self-chaining walkthrough when the *Dashboard* tour shows its first
    // step, and Settings' "Show the app guide again" sends the user to `TOUR_SEQUENCE[0]` to
    // restart the guide from the beginning. Reordering this list without moving the Dashboard
    // back to the front would quietly break both.
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
  it("starts on the first step the Dashboard tour shows", () => {
    expect(startsWalkthrough("dashboard", { firstStep: true, replay: false })).toBe(true);
  });

  it("does not start on a replay of the Dashboard tour", () => {
    // The reported bug: (i) on the Dashboard reset the tour's "shown anything yet" state, so a
    // replay looked like a first run and Done carried the user off to Add Expense.
    expect(startsWalkthrough("dashboard", { firstStep: true, replay: true })).toBe(false);
  });

  it("does not start from any later step, or from any other tab's tour", () => {
    expect(startsWalkthrough("dashboard", { firstStep: false, replay: false })).toBe(false);
    expect(startsWalkthrough("packet", { firstStep: true, replay: false })).toBe(false);
  });
});
