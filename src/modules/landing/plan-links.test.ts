import { describe, expect, it } from "vitest";

import { DEMO_REQUEST_HREF, getStartedHref, planPriceLabel, yearlySavingCents } from "@/src/modules/landing/plan-links";

describe("planPriceLabel", () => {
  it("drops the fraction when it's .00", () => {
    expect(planPriceLabel(29_700)).toBe("$297");
    expect(planPriceLabel(356_400)).toBe("$3,564");
  });

  it("keeps the fraction otherwise", () => {
    expect(planPriceLabel(29_750)).toBe("$297.50");
  });
});

describe("yearlySavingCents", () => {
  it("is null when yearly is exactly 12x monthly", () => {
    expect(yearlySavingCents({ month: 29_700, year: 29_700 * 12 })).toBeNull();
  });

  it("is the difference when yearly is cheaper", () => {
    expect(yearlySavingCents({ month: 29_700, year: 300_000 })).toBe(29_700 * 12 - 300_000);
  });

  it("is null when yearly is dearer than 12x monthly", () => {
    expect(yearlySavingCents({ month: 29_700, year: 29_700 * 12 + 1 })).toBeNull();
  });
});

describe("getStartedHref", () => {
  it("always lands on the walkthrough anchor while signup is closed", () => {
    expect(getStartedHref(false)).toBe(DEMO_REQUEST_HREF);
    expect(getStartedHref(false, "reconciliation", "month")).toBe(DEMO_REQUEST_HREF);
  });

  it("is plain /signup when signup is open with no plan given", () => {
    expect(getStartedHref(true)).toBe("/signup");
  });

  it("carries a real plan and interval through the URL", () => {
    expect(getStartedHref(true, "reconciliation", "year")).toBe("/signup?plan=reconciliation&interval=year");
  });

  it("falls back to plain /signup for a forged plan", () => {
    expect(getStartedHref(true, "x&next=//evil" as never, "year")).toBe("/signup");
  });

  it("falls back to plain /signup for a forged or missing interval on a real plan", () => {
    expect(getStartedHref(true, "reconciliation", "week")).toBe("/signup");
    expect(getStartedHref(true, "reconciliation")).toBe("/signup");
  });

  it("ignores inherited object keys as plan or interval", () => {
    expect(getStartedHref(true, "__proto__", "month")).toBe("/signup");
    expect(getStartedHref(true, "toString", "month")).toBe("/signup");
    expect(getStartedHref(true, "reconciliation", "constructor")).toBe("/signup");
  });
});
