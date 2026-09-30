/**
 * `draftNeeds` / `draftIsReady` (Phase 14 §7).
 *
 * The rule these encode is what stands between an incomplete draft and a real expense on a
 * document the City reads, and it is asked by three callers that must agree. Each test here is
 * one way a draft can be unfinished.
 */
import { describe, expect, it } from "vitest";

import {
  draftIsReady,
  draftNeeds,
  draftsReviewHref,
  waitingDraftTotals,
  type DraftReadiness,
} from "./draft-rules";
import { UI } from "./strings";

/** A draft with everything it needs; each test removes exactly one thing. */
function ready(overrides: Partial<DraftReadiness> = {}): DraftReadiness {
  return {
    name: "Detroit Sound Supply",
    lineItemId: "11111111-1111-7111-8111-111111111111",
    paymentSource: "Operating account",
    date: "2026-03-14",
    narrative: "Cable and connectors for the March community event.",
    ...overrides,
  };
}

describe("draftNeeds", () => {
  it("asks for nothing when the draft is complete", () => {
    expect(draftNeeds(ready())).toEqual([]);
    expect(draftIsReady(ready())).toBe(true);
  });

  it("names a missing line item", () => {
    expect(draftNeeds(ready({ lineItemId: null }))).toEqual([UI.draftNeedsLineItem]);
    expect(draftIsReady(ready({ lineItemId: null }))).toBe(false);
  });

  it("names a missing narrative, whether it is null, empty or only spaces", () => {
    for (const narrative of [null, "", "   ", "\n\t "]) {
      expect(draftNeeds(ready({ narrative }))).toEqual([UI.draftNeedsNarrative]);
      expect(draftIsReady(ready({ narrative }))).toBe(false);
    }
  });

  it("names both, in reading order, when both are missing", () => {
    expect(draftNeeds(ready({ lineItemId: null, narrative: null }))).toEqual([
      UI.draftNeedsLineItem,
      UI.draftNeedsNarrative,
    ]);
  });

  it("falls back to the form's own sentence for a blank name, payment source or date", () => {
    expect(draftNeeds(ready({ name: "   " }))).toEqual([UI.expenseMissingFields]);
    expect(draftNeeds(ready({ paymentSource: "" }))).toEqual([UI.expenseMissingFields]);
    expect(draftNeeds(ready({ date: "not-a-date" }))).toEqual([UI.expenseMissingFields]);
    expect(draftNeeds(ready({ date: "2026-02-30" }))).toEqual([UI.expenseMissingFields]);
  });

  it("does not ask for a receipt or a proof of payment, which gate the download and not the save", () => {
    // Nothing about documents is even representable in the input, which is the point: a draft
    // missing its proof is still approvable, exactly as a hand-added expense is (R4.3 vs R4.7).
    const needs = draftNeeds(ready());
    expect(needs).toEqual([]);
    expect(JSON.stringify(needs)).not.toMatch(/proof|receipt/i);
  });

  it("treats a $0.00 or negative amount as approvable, because neither is missing information", () => {
    // Amounts are not part of readiness at all. A refund line and a zero line are real charges.
    expect(draftIsReady(ready())).toBe(true);
  });
});

/**
 * `waitingDraftTotals` / `draftsReviewHref` (usability #64): the drafts reminder on the
 * dashboard and packet page. Only reported, never counted (PHASE-14 §6); the figure is the
 * same reimbursable total each draft row shows.
 */
describe("waitingDraftTotals", () => {
  const A = "0190a000-0000-7000-8000-00000000000a";
  const B = "0190a000-0000-7000-8000-00000000000b";

  it("is empty with no drafts, so no section finds a notice (E9)", () => {
    const totals = waitingDraftTotals([]);
    expect(totals.size).toBe(0);
    expect(totals.get(A)).toBeUndefined();
  });

  it("counts one draft with its own amount (E10)", () => {
    expect(waitingDraftTotals([{ fundingSourceId: A, reimbursableCents: 12000 }]).get(A)).toEqual({
      count: 1,
      totalCents: 12000,
    });
  });

  it("keeps each source's drafts to that source: drafts on B only give A nothing (E11, E12)", () => {
    const totals = waitingDraftTotals([
      { fundingSourceId: B, reimbursableCents: 5000 },
      { fundingSourceId: B, reimbursableCents: 2500 },
    ]);
    expect(totals.get(A)).toBeUndefined();
    expect(totals.get(B)).toEqual({ count: 2, totalCents: 7500 });
  });

  it("groups a mixed list per source, not one pooled total", () => {
    const totals = waitingDraftTotals([
      { fundingSourceId: A, reimbursableCents: 100 },
      { fundingSourceId: B, reimbursableCents: 20000 },
      { fundingSourceId: A, reimbursableCents: 250 },
    ]);
    expect(totals.get(A)).toEqual({ count: 2, totalCents: 350 });
    expect(totals.get(B)).toEqual({ count: 1, totalCents: 20000 });
    expect(totals.size).toBe(2);
  });

  it("sums a $0.00 draft and a refund as they are: a count with a zero or negative total (E14)", () => {
    expect(waitingDraftTotals([{ fundingSourceId: A, reimbursableCents: 0 }]).get(A)).toEqual({
      count: 1,
      totalCents: 0,
    });
    expect(
      waitingDraftTotals([
        { fundingSourceId: A, reimbursableCents: 0 },
        { fundingSourceId: A, reimbursableCents: -1000 },
      ]).get(A),
    ).toEqual({ count: 2, totalCents: -1000 });
  });
});

describe("draftsReviewHref", () => {
  it("links to the drafts view alone when the header already holds a source", () => {
    expect(draftsReviewHref(null)).toBe("/r/expenses?view=drafts");
  });

  it("carries the section's source when the header is on All (E12)", () => {
    expect(draftsReviewHref("0190a000-0000-7000-8000-00000000000b")).toBe(
      "/r/expenses?view=drafts&source=0190a000-0000-7000-8000-00000000000b",
    );
  });

  it("encodes the id, so nothing in it can add a parameter", () => {
    expect(draftsReviewHref("a&view=all")).toBe("/r/expenses?view=drafts&source=a%26view%3Dall");
  });
});
