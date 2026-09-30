/**
 * The read route's reply as the form receives it (Phase 10, Phase 19): the amounts, and a
 * receipt's vendor and date whether or not its amounts could be read.
 */
import { describe, expect, it } from "vitest";

import { readResultFrom } from "./use-amount-reads";

const amounts = { subtotalCents: 8000, taxCents: 417, feesCents: 0, totalCents: 8417 };

describe("readResultFrom", () => {
  it("amounts found, with a vendor and date", () => {
    expect(
      readResultFrom(true, { ok: true, data: { found: true, ...amounts, vendor: "Home Depot", date: "2026-09-12" } }),
    ).toEqual({ status: "found", amounts, details: { vendor: "Home Depot", date: "2026-09-12" } });
  });

  it("no amount found still carries the vendor and date", () => {
    expect(readResultFrom(true, { ok: true, data: { found: false, vendor: "Cafe Luna" } })).toEqual({
      status: "none",
      details: { vendor: "Cafe Luna", date: null },
    });
  });

  it("a reply with neither has no details, exactly as before Phase 19", () => {
    expect(readResultFrom(true, { ok: true, data: { found: true, ...amounts } })).toEqual({ status: "found", amounts });
    expect(readResultFrom(true, { ok: true, data: { found: false } })).toEqual({ status: "none" });
  });

  it("a refused or failed read carries nothing", () => {
    expect(readResultFrom(false, { ok: false, data: { found: false, vendor: "Home Depot" } })).toEqual({ status: "none" });
    expect(readResultFrom(false, null)).toEqual({ status: "none" });
    expect(readResultFrom(false, { ok: false, code: "too-long" })).toEqual({ status: "none", reason: "too-long" });
  });

  it("ignores a vendor or date that is not a string", () => {
    const odd = { ok: true, data: { found: false, vendor: 42, date: ["2026-09-12"] } } as unknown as Parameters<typeof readResultFrom>[1];
    expect(readResultFrom(true, odd)).toEqual({ status: "none" });
  });
});
