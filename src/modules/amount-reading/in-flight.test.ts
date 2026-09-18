/**
 * Unit tests for the per-org concurrent-read cap (PR #18 review, `MAX_IN_FLIGHT_PER_ORG`).
 */
import { describe, expect, it } from "vitest";

import { beginRead, endRead, MAX_IN_FLIGHT_PER_ORG, readsInFlight } from "./in-flight";

describe("beginRead / endRead", () => {
  it("MAX_IN_FLIGHT_PER_ORG is 4 (the cap this suite assumes)", () => {
    expect(MAX_IN_FLIGHT_PER_ORG).toBe(4);
  });

  it("takes a slot for each of the first 4 reads, then refuses the 5th", () => {
    const orgId = `org-${Math.random()}`;
    try {
      for (let i = 0; i < MAX_IN_FLIGHT_PER_ORG; i += 1) {
        expect(beginRead(orgId)).toBe(true);
      }
      expect(readsInFlight(orgId)).toBe(4);
      expect(beginRead(orgId)).toBe(false); // 5th — refused
      expect(readsInFlight(orgId)).toBe(4); // refused read never took a slot
    } finally {
      for (let i = 0; i < MAX_IN_FLIGHT_PER_ORG; i += 1) endRead(orgId);
    }
  });

  it("freeing a slot lets a new read in, still bounded by the cap", () => {
    const orgId = `org-${Math.random()}`;
    try {
      for (let i = 0; i < MAX_IN_FLIGHT_PER_ORG; i += 1) beginRead(orgId);
      expect(beginRead(orgId)).toBe(false);

      endRead(orgId);
      expect(readsInFlight(orgId)).toBe(3);
      expect(beginRead(orgId)).toBe(true); // one slot freed, one taken back
      expect(beginRead(orgId)).toBe(false); // still at the cap
    } finally {
      for (let i = 0; i < MAX_IN_FLIGHT_PER_ORG; i += 1) endRead(orgId);
    }
  });

  it("endRead never goes negative and clears the entry at zero", () => {
    const orgId = `org-${Math.random()}`;
    endRead(orgId); // never began — must not throw or go negative
    expect(readsInFlight(orgId)).toBe(0);

    beginRead(orgId);
    endRead(orgId);
    endRead(orgId); // extra end beyond what was begun
    expect(readsInFlight(orgId)).toBe(0);
    expect(beginRead(orgId)).toBe(true); // the org can read again immediately, not stuck locked out
    endRead(orgId);
  });

  it("the cap is per-organisation: one org at the cap never blocks another org", () => {
    const orgA = `org-a-${Math.random()}`;
    const orgB = `org-b-${Math.random()}`;
    try {
      for (let i = 0; i < MAX_IN_FLIGHT_PER_ORG; i += 1) beginRead(orgA);
      expect(beginRead(orgA)).toBe(false);
      expect(beginRead(orgB)).toBe(true);
    } finally {
      for (let i = 0; i < MAX_IN_FLIGHT_PER_ORG; i += 1) endRead(orgA);
      endRead(orgB);
    }
  });
});
