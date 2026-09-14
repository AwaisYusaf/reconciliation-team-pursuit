/**
 * `TOUR_SEQUENCE`/`nextInSequence` (Phase 7, D-95) — the walkthrough order the auto-advancing
 * guided tour follows. Pure logic, extracted from `tour.tsx` the same way `resolve-steps.ts`
 * was, so it's testable without a jsdom harness this repo doesn't have.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { tourKey } from "@/src/db/schema";

import {
  continueTourSequence,
  nextInSequence,
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

describe("continueTourSequence", () => {
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

  it("navigates to the next tab while a walkthrough is running", () => {
    stubStorage();
    store.set(TOUR_SEQUENCE_KEY, "1");
    const router = stubRouter();

    continueTourSequence("dashboard", router);

    expect(router.push).toHaveBeenCalledWith("/r/expenses/new");
    // Paired with the push so the next tab can't be served a prefetched, stale `alreadySeen`.
    expect(router.refresh).toHaveBeenCalled();
  });

  it("carries on past a screen that showed nothing — the Cover Sheets/Packet dead-end", () => {
    // With "All funding sources" selected these tabs render a "choose a source" panel, so
    // their tours have nothing to point at. The walkthrough used to stop at the first one and
    // never reach the five tabs after it.
    stubStorage();
    store.set(TOUR_SEQUENCE_KEY, "1");
    const router = stubRouter();

    continueTourSequence("cover_sheets", router);

    expect(router.push).toHaveBeenCalledWith("/r/recurring");
  });

  it("does nothing at all when no walkthrough is running", () => {
    stubStorage();
    const router = stubRouter();

    continueTourSequence("dashboard", router);

    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("ends the walkthrough at the last tab instead of navigating", () => {
    stubStorage();
    store.set(TOUR_SEQUENCE_KEY, "1");
    const router = stubRouter();

    continueTourSequence(TOUR_SEQUENCE[TOUR_SEQUENCE.length - 1].tour, router);

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
