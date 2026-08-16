import { describe, expect, it } from "vitest";

import {
  compareMonthKeys,
  currentMonthKey,
  daysInMonthKey,
  formatDateUS,
  invoicePeriod,
  isValidIsoDate,
  isValidMonthKey,
  monthBounds,
  monthKeyFromLabel,
  monthKeyOfDate,
  monthLabel,
  monthShortLabel,
  monthWindow,
  shiftMonth,
  todayIso,
} from "./dates";

describe("organisation timezone (R2.5)", () => {
  it("uses the Detroit calendar date, not UTC", () => {
    // 2026-03-03 01:30 UTC is still 2026-03-02 20:30 in Detroit.
    const lateEvening = new Date("2026-03-03T01:30:00Z");
    expect(todayIso(lateEvening)).toBe("2026-03-02");
    expect(currentMonthKey(lateEvening)).toBe("2026-03");
  });

  it("keeps the month from rolling over a day early", () => {
    // 2026-03-01 02:00 UTC is 2026-02-28 21:00 in Detroit — still February.
    const monthEdge = new Date("2026-03-01T02:00:00Z");
    expect(todayIso(monthEdge)).toBe("2026-02-28");
    expect(currentMonthKey(monthEdge)).toBe("2026-02");
  });

  it("handles daylight-saving transitions", () => {
    // DST begins 2026-03-08; 06:30 UTC is 01:30 EST on the 8th.
    expect(todayIso(new Date("2026-03-08T06:30:00Z"))).toBe("2026-03-08");
    // After the jump, 07:30 UTC is 03:30 EDT, still the 8th.
    expect(todayIso(new Date("2026-03-08T07:30:00Z"))).toBe("2026-03-08");
  });
});

describe("month keys (R2.1)", () => {
  it("validates", () => {
    expect(isValidMonthKey("2026-02")).toBe(true);
    expect(isValidMonthKey("2026-12")).toBe(true);
    expect(isValidMonthKey("2026-00")).toBe(false);
    expect(isValidMonthKey("2026-13")).toBe(false);
    expect(isValidMonthKey("2026-2")).toBe(false);
    expect(isValidMonthKey("26-02")).toBe(false);
    expect(isValidMonthKey("")).toBe(false);
  });

  it("labels and parses labels", () => {
    expect(monthLabel("2026-02")).toBe("February 2026");
    expect(monthLabel("2026-12")).toBe("December 2026");
    expect(monthShortLabel("2026-03")).toBe("Mar");
    expect(monthKeyFromLabel("February 2026")).toBe("2026-02");
    expect(monthKeyFromLabel("  march 2026 ")).toBe("2026-03");
    expect(monthKeyFromLabel("Smarch 2026")).toBeNull();
    expect(monthKeyFromLabel("2026-02")).toBeNull();
  });

  it("shifts across year boundaries", () => {
    expect(shiftMonth("2026-02", 1)).toBe("2026-03");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-06", -12)).toBe("2025-06");
    expect(shiftMonth("2026-06", 0)).toBe("2026-06");
  });

  it("sorts chronologically as plain strings", () => {
    expect(compareMonthKeys("2026-01", "2026-02")).toBe(-1);
    expect(compareMonthKeys("2027-01", "2026-12")).toBe(1);
    expect(compareMonthKeys("2026-05", "2026-05")).toBe(0);
    const keys = ["2026-10", "2025-12", "2026-02"];
    expect([...keys].sort(compareMonthKeys)).toEqual(["2025-12", "2026-02", "2026-10"]);
  });

  it("derives a month from a date (R2.2)", () => {
    expect(monthKeyOfDate("2026-03-02")).toBe("2026-03");
  });

  it("throws on malformed keys rather than silently guessing", () => {
    expect(() => monthLabel("2026-99")).toThrow(/Invalid month key/);
  });
});

describe("calendar arithmetic", () => {
  it("counts days, including leap Februaries", () => {
    expect(daysInMonthKey("2026-02")).toBe(28);
    expect(daysInMonthKey("2028-02")).toBe(29);
    expect(daysInMonthKey("2026-04")).toBe(30);
    expect(daysInMonthKey("2026-12")).toBe(31);
  });

  it("builds the invoice period string (R2.4)", () => {
    expect(invoicePeriod("2026-02")).toBe("2/1/2026 to 2/28/2026");
    expect(invoicePeriod("2026-03")).toBe("3/1/2026 to 3/31/2026");
    expect(invoicePeriod("2028-02")).toBe("2/1/2028 to 2/29/2028");
  });

  it("returns month bounds as ISO dates", () => {
    expect(monthBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthBounds("2026-11")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });
});

describe("date-only formatting", () => {
  it("formats without any timezone shift", () => {
    expect(formatDateUS("2026-03-02")).toBe("3/2/2026");
    expect(formatDateUS("2026-12-31")).toBe("12/31/2026");
    // The classic UTC bug: new Date("2026-01-01") in a negative-offset zone yields Dec 31.
    expect(formatDateUS("2026-01-01")).toBe("1/1/2026");
  });

  it("validates ISO dates including month lengths", () => {
    expect(isValidIsoDate("2026-03-02")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-04-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("3/2/2026")).toBe(false);
  });
});

describe("monthWindow (m00 selector)", () => {
  const now = new Date("2026-08-16T12:00:00Z");

  it("spans 12 months back through 3 ahead, newest first", () => {
    const window = monthWindow([], now);
    expect(window[0]).toBe("2026-11");
    expect(window.at(-1)).toBe("2025-08");
    expect(window).toHaveLength(16);
    expect(window).toContain("2026-08");
  });

  it("includes months that hold data even outside the window", () => {
    const window = monthWindow(["2024-01"], now);
    expect(window).toContain("2024-01");
    expect(window.at(-1)).toBe("2024-01");
  });

  it("does not duplicate in-window data months and ignores junk", () => {
    const window = monthWindow(["2026-02", "2026-02", "nonsense"], now);
    expect(window.filter((m) => m === "2026-02")).toHaveLength(1);
    expect(window).not.toContain("nonsense");
  });
});
