// Ported from the reference build's lib/plans.test.ts (Phase 16 §12), node:test/SQLite → vitest.
// `hasAccess` there combined plan + feature + status; here that split is `orgEntitlement`
// (paid + plan) then `planIncludes` (plan + feature) — each tested at its own layer.
import { describe, expect, it } from "vitest";

import {
  changeBlockedReason,
  classifyChange,
  fundingSourceLimit,
  INTERVALS,
  isInterval,
  isLive,
  isPlanId,
  pickCurrent,
  planIncludes,
  type Interval,
  type PlanId,
} from "./rules";

// ── Features per plan (U-3) ──────────────────────────────────────────────────

describe("planIncludes", () => {
  it("Reconciliation + AI has every AI feature", () => {
    expect(planIncludes("reconciliation_ai", "amount_read")).toBe(true);
    expect(planIncludes("reconciliation_ai", "monthly_summary")).toBe(true);
    expect(planIncludes("reconciliation_ai", "invoice_read")).toBe(true);
  });

  it("Reconciliation has none", () => {
    expect(planIncludes("reconciliation", "amount_read")).toBe(false);
    expect(planIncludes("reconciliation", "monthly_summary")).toBe(false);
    expect(planIncludes("reconciliation", "invoice_read")).toBe(false);
  });
});

describe("fundingSourceLimit", () => {
  it("Reconciliation allows one; Reconciliation + AI is unlimited", () => {
    expect(fundingSourceLimit("reconciliation")).toBe(1);
    expect(fundingSourceLimit("reconciliation_ai")).toBe(null);
  });
});

// ── Input guards ─────────────────────────────────────────────────────────────

describe("isPlanId / isInterval", () => {
  it("form input guards reject anything not in the lists", () => {
    expect(isPlanId("reconciliation_ai")).toBe(true);
    for (const bad of ["constructor", "__proto__", "toString", "", null, undefined, 1]) {
      expect(isPlanId(bad), String(bad)).toBe(false);
    }
    expect(isInterval("year")).toBe(true);
    for (const bad of ["week", "day", "", null]) {
      expect(isInterval(bad), String(bad)).toBe(false);
    }
  });
});

// ── Which subscription counts ────────────────────────────────────────────────

describe("pickCurrent", () => {
  it("a late event about an old cancelled subscription never beats the new live one", () => {
    const old = { id: "old", status: "canceled", created: 100 };
    const now = { id: "new", status: "active", created: 200 };
    expect(pickCurrent([old, now])?.id).toBe("new");
    expect(pickCurrent([now, old])?.id).toBe("new");
  });

  it("a live subscription wins over a newer abandoned checkout", () => {
    const live = { id: "live", status: "past_due", created: 100 };
    expect(pickCurrent([live, { id: "x", status: "incomplete_expired", created: 300 }])?.id).toBe("live");
    expect(pickCurrent([live, { id: "y", status: "incomplete", created: 300 }])?.id).toBe("live");
  });

  it("all dead picks the newest; none picks undefined", () => {
    const a = { id: "a", status: "canceled", created: 100 };
    const b = { id: "b", status: "canceled", created: 200 };
    expect(pickCurrent([a, b])?.id).toBe("b");
    expect(pickCurrent([])).toBe(undefined);
  });

  it("a single subscription, live or dead, is itself", () => {
    expect(pickCurrent([{ id: "only", status: "active", created: 1 }])?.id).toBe("only");
    expect(pickCurrent([{ id: "only", status: "canceled", created: 1 }])?.id).toBe("only");
  });

  it("a tie on created (same timestamp) still resolves deterministically, live one still wins", () => {
    const dead = { id: "dead", status: "canceled", created: 500 };
    const live = { id: "live", status: "active", created: 500 };
    expect(pickCurrent([dead, live])?.id).toBe("live");
    expect(pickCurrent([live, dead])?.id).toBe("live");
  });

  it("two dead subscriptions tied on created: sort is stable, doesn't throw, and picks one of them", () => {
    const a = { id: "a", status: "canceled", created: 500 };
    const b = { id: "b", status: "canceled", created: 500 };
    const result = pickCurrent([a, b]);
    expect(["a", "b"]).toContain(result?.id);
  });
});

describe("isLive", () => {
  it("an abandoned first payment (incomplete) never blocks trying again", () => {
    for (const s of ["active", "trialing", "past_due", "unpaid", "paused"]) expect(isLive(s), s).toBe(true);
    for (const s of ["incomplete", "incomplete_expired", "canceled", null]) {
      expect(isLive(s), String(s)).toBe(false);
    }
  });
});

// ── Plan changes: every one of the 16 from → to pairs (U-2) ──────────────────

const R: PlanId = "reconciliation";
const AI: PlanId = "reconciliation_ai";
const PLAN_IDS: readonly PlanId[] = [R, AI];
const expected: Record<string, string> = {
  "R-month>R-month": "none",
  "R-month>R-year": "now",
  "R-month>AI-month": "now",
  "R-month>AI-year": "now",
  "R-year>R-month": "at_period_end",
  "R-year>R-year": "none",
  "R-year>AI-month": "at_period_end",
  "R-year>AI-year": "now",
  "AI-month>R-month": "at_period_end",
  "AI-month>R-year": "at_period_end",
  "AI-month>AI-month": "none",
  "AI-month>AI-year": "now",
  "AI-year>R-month": "at_period_end",
  "AI-year>R-year": "at_period_end",
  "AI-year>AI-month": "at_period_end",
  "AI-year>AI-year": "none",
};

describe("classifyChange", () => {
  it("all 16 combinations follow 'gives more → now, gives less on either axis → period end'", () => {
    const name = (p: PlanId) => (p === R ? "R" : "AI");
    let checked = 0;
    for (const fp of PLAN_IDS)
      for (const fi of INTERVALS)
        for (const tp of PLAN_IDS)
          for (const ti of INTERVALS) {
            const key = `${name(fp)}-${fi}>${name(tp)}-${ti}`;
            expect(
              classifyChange({ plan: fp, interval: fi as Interval }, { plan: tp, interval: ti as Interval }),
              key,
            ).toBe(expected[key]);
            checked++;
          }
    expect(checked).toBe(16);
  });
});

describe("changeBlockedReason", () => {
  it("only an active, not-cancelling subscription may switch", () => {
    expect(changeBlockedReason({ status: "active", cancel_at_period_end: 0 })).toBe(null);
    expect(changeBlockedReason({ status: "trialing", cancel_at_period_end: false })).toBe(null);
    expect(changeBlockedReason({ status: "active", cancel_at_period_end: 1 })).toBe("cancel_pending");
    expect(changeBlockedReason({ status: "past_due", cancel_at_period_end: 0 })).toBe("payment_failed");
    expect(changeBlockedReason({ status: "unpaid", cancel_at_period_end: 0 })).toBe("payment_failed");
    for (const s of ["canceled", "incomplete", "paused", null]) {
      expect(changeBlockedReason({ status: s, cancel_at_period_end: 0 }), String(s)).toBe("no_plan");
    }
  });
});
