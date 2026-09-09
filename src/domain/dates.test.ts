import { describe, expect, it } from "vitest";

import {
  compareMonthKeys,
  currentMonthKey,
  daysInMonthKey,
  formatDateTimeUS,
  formatDateUS,
  invoicePeriod,
  isValidIsoDate,
  isValidMonthKey,
  monthBounds,
  monthKeyFromLabel,
  monthKeyOfDate,
  monthLabel,
  monthShortLabel,
  MAX_CONTRACT_MONTHS,
  contractMonths,
  monthWindow,
  monthsByYear,
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

  it("formats an instant in the org timezone, including the Detroit-vs-UTC evening case", () => {
    expect(formatDateTimeUS(new Date("2026-02-14T20:04:00Z"))).toBe("02/14/2026, 3:04 PM");
    // 2026-03-03 01:30 UTC is still 2026-03-02, evening, in Detroit — same case as R2.5 above.
    expect(formatDateTimeUS(new Date("2026-03-03T01:30:00Z"))).toBe("03/02/2026, 8:30 PM");
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

describe("contractMonths", () => {
  it("spans both ends inclusively", () => {
    const months = contractMonths("2025-07-01", "2026-06-30");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-07");
    expect(months.at(-1)).toBe("2026-06");
  });

  it("crosses new years, so a multi-year contract reaches its end", () => {
    const months = contractMonths("2025-07-01", "2027-06-30");
    expect(months).toHaveLength(24);
    expect(months).toContain("2026-12");
    expect(months.at(-1)).toBe("2027-06");
  });

  it("uses the month a date falls in, not whole months only", () => {
    // A contract starting mid-month still has that month as a reporting month.
    expect(contractMonths("2025-07-18", "2025-09-04")).toEqual(["2025-07", "2025-08", "2025-09"]);
  });

  it("is a single month when both dates share one", () => {
    expect(contractMonths("2026-02-01", "2026-02-28")).toEqual(["2026-02"]);
  });

  it("yields nothing without both dates, so the rolling window still applies", () => {
    expect(contractMonths(null, "2027-06-30")).toEqual([]);
    expect(contractMonths("2025-07-01", null)).toEqual([]);
    expect(contractMonths(undefined, undefined)).toEqual([]);
  });

  it("yields nothing for junk or a backwards span", () => {
    expect(contractMonths("not-a-date", "2027-06-30")).toEqual([]);
    expect(contractMonths("2027-06-30", "2025-07-01")).toEqual([]);
  });

  it("caps a mistyped year rather than generating a decade of options", () => {
    // A fat-fingered "2299" must not hand the selector 3,000 entries.
    const months = contractMonths("2025-07-01", "2299-06-30");
    expect(months).toHaveLength(MAX_CONTRACT_MONTHS);
    expect(months[0]).toBe("2025-07");
  });
});

describe("monthsByYear", () => {
  it("buckets consecutive months under their year, order preserved", () => {
    const groups = monthsByYear(["2027-01", "2026-12", "2026-11", "2025-03"]);
    expect(groups.map((group) => group.year)).toEqual(["2027", "2026", "2025"]);
    expect(groups[1].months).toEqual(["2026-12", "2026-11"]);
  });

  it("is empty for no months", () => {
    expect(monthsByYear([])).toEqual([]);
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

  it("includes contract months beyond the window's three-month lookahead", () => {
    // The whole point: a contract running to mid-2027 is selectable in August 2026,
    // where the rolling window alone stops at November.
    const window = monthWindow(contractMonths("2025-07-01", "2027-06-30"), now);
    expect(window[0]).toBe("2027-06");
    expect(window).toContain("2026-12");
    expect(window.at(-1)).toBe("2025-07");
  });

  it("does not duplicate a contract month that also holds data", () => {
    const window = monthWindow([...contractMonths("2026-01-01", "2026-03-31"), "2026-02"], now);
    expect(window.filter((month) => month === "2026-02")).toHaveLength(1);
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
