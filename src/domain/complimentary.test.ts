import { describe, expect, it } from "vitest";

import { complimentaryState, isComplimentaryNow } from "./complimentary";

describe("complimentaryState (Phase 9 §7 Q6)", () => {
  const today = "2027-01-01";

  it("is 'none' when complimentary is off, even with a date set", () => {
    expect(complimentaryState({ complimentary: false, complimentaryUntil: null }, today)).toBe("none");
    expect(complimentaryState({ complimentary: false, complimentaryUntil: "2099-01-01" }, today)).toBe(
      "none",
    );
  });

  it("is 'active' with no end date", () => {
    expect(complimentaryState({ complimentary: true, complimentaryUntil: null }, today)).toBe("active");
  });

  it("an end date of exactly today is still active (Q6)", () => {
    expect(complimentaryState({ complimentary: true, complimentaryUntil: today }, today)).toBe("active");
  });

  it("an end date of yesterday has ended", () => {
    expect(complimentaryState({ complimentary: true, complimentaryUntil: "2026-12-31" }, today)).toBe(
      "ended",
    );
  });

  it("an end date far in the future is active", () => {
    expect(complimentaryState({ complimentary: true, complimentaryUntil: "2030-06-01" }, today)).toBe(
      "active",
    );
  });

  it("compares safely across a year/month rollover, not lexically within one field", () => {
    // 2026-12-31 < 2027-01-01 as ISO strings, but a naive "same year" or "same month" compare
    // would get this wrong; the plain string comparison the implementation uses is exercised here.
    expect(complimentaryState({ complimentary: true, complimentaryUntil: "2026-12-31" }, "2027-01-01")).toBe(
      "ended",
    );
  });
});

describe("isComplimentaryNow (Phase 16, P10)", () => {
  const today = "2027-01-01";

  it("is true only while complimentaryState is 'active'", () => {
    expect(isComplimentaryNow({ complimentary: true, complimentaryUntil: null }, today)).toBe(true);
    expect(isComplimentaryNow({ complimentary: true, complimentaryUntil: today }, today)).toBe(true);
  });

  it("is false when off or ended", () => {
    expect(isComplimentaryNow({ complimentary: false, complimentaryUntil: null }, today)).toBe(false);
    expect(isComplimentaryNow({ complimentary: true, complimentaryUntil: "2026-12-31" }, today)).toBe(false);
  });
});
