/**
 * `TOUR_SEQUENCE`/`nextInSequence` (Phase 7, D-95) — the walkthrough order the auto-advancing
 * guided tour follows. Pure logic, extracted from `tour.tsx` the same way `resolve-steps.ts`
 * was, so it's testable without a jsdom harness this repo doesn't have.
 */
import { describe, expect, it } from "vitest";

import { tourKey } from "@/src/db/schema";

import { nextInSequence, TOUR_SEQUENCE } from "./sequence";

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
