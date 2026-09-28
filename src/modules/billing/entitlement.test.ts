import { describe, expect, it } from "vitest";

import { KNOWN_STRIPE_STATUSES, type PlanId } from "./rules";
import { activeFundingSourceLimit, orgEntitlement, reconciliationStartsOn, type EntitlementOrg } from "./entitlement";

const base: EntitlementOrg = {
  plan: "reconciliation",
  complimentary: false,
  complimentaryUntil: null,
  complimentaryPlan: null,
  stripeStatus: null,
};
const today = "2027-01-01";

describe("orgEntitlement: billing off", () => {
  it("is always paid, on the org's own plan (today's behaviour, P25)", () => {
    expect(orgEntitlement(base, today, false)).toEqual({
      paid: true,
      plan: "reconciliation",
      reason: "billing_off",
    });
    expect(orgEntitlement({ ...base, stripeStatus: "canceled" }, today, false).paid).toBe(true);
  });
});

describe("orgEntitlement: complimentary", () => {
  it("paid on complimentaryPlan when set, otherwise plan", () => {
    const ent = orgEntitlement({ ...base, complimentary: true, complimentaryPlan: "reconciliation_ai" }, today, true);
    expect(ent).toEqual({ paid: true, plan: "reconciliation_ai", reason: "complimentary" });
  });

  it("an end date of today still counts", () => {
    const ent = orgEntitlement({ ...base, complimentary: true, complimentaryUntil: today }, today, true);
    expect(ent.paid).toBe(true);
  });

  it("ended complimentary access, no live subscription, is 'complimentary_ended'", () => {
    const ent = orgEntitlement({ ...base, complimentary: true, complimentaryUntil: "2026-12-31" }, today, true);
    expect(ent).toEqual({ paid: false, plan: "reconciliation", reason: "complimentary_ended" });
  });

  it("a live subscription wins even once complimentary access has ended (P9's order)", () => {
    const ent = orgEntitlement(
      { ...base, complimentary: true, complimentaryUntil: "2026-12-31", stripeStatus: "active" },
      today,
      true,
    );
    expect(ent).toEqual({ paid: true, plan: "reconciliation", reason: "subscription" });
  });
});

describe("orgEntitlement: subscription statuses", () => {
  it("active, trialing and past_due are paid", () => {
    for (const stripeStatus of ["active", "trialing", "past_due"]) {
      expect(orgEntitlement({ ...base, stripeStatus }, today, true).paid, stripeStatus).toBe(true);
    }
  });

  it("null, incomplete and incomplete_expired (never paid) are 'new'", () => {
    for (const stripeStatus of [null, "incomplete", "incomplete_expired"]) {
      const ent = orgEntitlement({ ...base, stripeStatus }, today, true);
      expect(ent, String(stripeStatus)).toEqual({ paid: false, plan: "reconciliation", reason: "new" });
    }
  });

  it("canceled and unpaid (once paid, now not) are 'ended'", () => {
    for (const stripeStatus of ["canceled", "unpaid", "paused"]) {
      const ent = orgEntitlement({ ...base, stripeStatus }, today, true);
      expect(ent, stripeStatus).toEqual({ paid: false, plan: "reconciliation", reason: "ended" });
    }
  });

  it("an unknown status is not paid and flagged, never crashes (P8)", () => {
    const ent = orgEntitlement({ ...base, stripeStatus: "some_future_status" }, today, true);
    expect(ent).toEqual({ paid: false, plan: "reconciliation", reason: "unknown_status" });
  });
});

// ── Exhaustive matrix (U-4, U-21): billing on/off × complimentary shape × complimentaryPlan ×
// every known stripeStatus, plus null, "" and an unknown one. ──────────────────────────────────
describe("orgEntitlement: exhaustive matrix", () => {
  const complimentaryShapes: Array<{
    label: string;
    complimentary: boolean;
    complimentaryUntil: string | null;
  }> = [
    { label: "none", complimentary: false, complimentaryUntil: null },
    { label: "open-ended", complimentary: true, complimentaryUntil: null },
    { label: "until today", complimentary: true, complimentaryUntil: today },
    { label: "until tomorrow", complimentary: true, complimentaryUntil: "2027-01-02" },
    { label: "until yesterday", complimentary: true, complimentaryUntil: "2026-12-31" },
    // complimentary=false with a future until must still be "none" — the flag gates it, not the date.
    { label: "off with a future until", complimentary: false, complimentaryUntil: "2099-01-01" },
  ];
  const complimentaryPlans: Array<PlanId | null> = [null, "reconciliation", "reconciliation_ai"];
  const statuses: Array<string | null> = [null, ...KNOWN_STRIPE_STATUSES, "", "foo"];

  it("billing off is always paid on plan, whatever else is set (incl. ended grants and canceled status)", () => {
    for (const shape of complimentaryShapes) {
      for (const complimentaryPlan of complimentaryPlans) {
        for (const stripeStatus of statuses) {
          const org: EntitlementOrg = {
            plan: "reconciliation",
            complimentary: shape.complimentary,
            complimentaryUntil: shape.complimentaryUntil,
            complimentaryPlan,
            stripeStatus,
          };
          const ent = orgEntitlement(org, today, false);
          expect(ent, `${shape.label} / cPlan=${complimentaryPlan} / status=${String(stripeStatus)}`).toEqual({
            paid: true,
            plan: "reconciliation",
            reason: "billing_off",
          });
        }
      }
    }
  });

  it("billing on: complimentary-now always wins regardless of stripeStatus, incl. beating a canceled subscription", () => {
    for (const complimentaryPlan of complimentaryPlans) {
      for (const stripeStatus of statuses) {
        const org: EntitlementOrg = {
          plan: "reconciliation",
          complimentary: true,
          complimentaryUntil: null, // open-ended: definitely "now"
          complimentaryPlan,
          stripeStatus,
        };
        const ent = orgEntitlement(org, today, true);
        expect(ent, `cPlan=${complimentaryPlan} / status=${String(stripeStatus)}`).toEqual({
          paid: true,
          plan: complimentaryPlan ?? "reconciliation",
          reason: "complimentary",
        });
      }
    }
  });

  it("billing on, not complimentary now: a live subscription status is paid on plan for every complimentary shape that has ended or is off", () => {
    for (const shape of [complimentaryShapes[0], complimentaryShapes[4], complimentaryShapes[5]]) {
      for (const stripeStatus of ["active", "trialing", "past_due"]) {
        const org: EntitlementOrg = {
          plan: "reconciliation",
          complimentary: shape.complimentary,
          complimentaryUntil: shape.complimentaryUntil,
          complimentaryPlan: null,
          stripeStatus,
        };
        const ent = orgEntitlement(org, today, true);
        expect(ent, `${shape.label} / status=${stripeStatus}`).toEqual({
          paid: true,
          plan: "reconciliation",
          reason: "subscription",
        });
      }
    }
  });

  it("billing on, not complimentary now: non-paid statuses resolve to the right reason", () => {
    const cases: Array<{ status: string | null; expected: "new" | "ended" | "unknown_status" }> = [
      { status: null, expected: "new" },
      { status: "incomplete", expected: "new" },
      { status: "incomplete_expired", expected: "new" },
      { status: "canceled", expected: "ended" },
      { status: "unpaid", expected: "ended" },
      { status: "paused", expected: "ended" },
      { status: "", expected: "unknown_status" },
      { status: "foo", expected: "unknown_status" },
    ];
    for (const { status, expected } of cases) {
      const org: EntitlementOrg = {
        plan: "reconciliation",
        complimentary: false,
        complimentaryUntil: null,
        complimentaryPlan: null,
        stripeStatus: status,
      };
      expect(orgEntitlement(org, today, true), String(status)).toEqual({
        paid: false,
        plan: "reconciliation",
        reason: expected,
      });
    }
  });

  it("an ended complimentary grant with a non-paid status is complimentary_ended (grant reason wins over generic 'ended')", () => {
    for (const stripeStatus of [null, "canceled", "foo"]) {
      const org: EntitlementOrg = {
        plan: "reconciliation",
        complimentary: true,
        complimentaryUntil: "2026-12-31",
        complimentaryPlan: null,
        stripeStatus,
      };
      expect(orgEntitlement(org, today, true), String(stripeStatus)).toEqual({
        paid: false,
        plan: "reconciliation",
        reason: "complimentary_ended",
      });
    }
  });

  it("a live subscription beats an ended complimentary grant (paid)", () => {
    const org: EntitlementOrg = {
      plan: "reconciliation",
      complimentary: true,
      complimentaryUntil: "2026-12-31",
      complimentaryPlan: "reconciliation_ai", // dead grant's plan must not leak through
      stripeStatus: "past_due",
    };
    expect(orgEntitlement(org, today, true)).toEqual({ paid: true, plan: "reconciliation", reason: "subscription" });
  });

  it("'today' is an IsoDate string compare: a month/year boundary is handled correctly", () => {
    // 2026-12-31 < 2027-01-01 lexically too, but 2026-09-30 vs 2026-10-01 would trip a naive
    // "same month" or numeric-without-padding compare; IsoDate strings are zero-padded so plain
    // string comparison is safe across every boundary.
    const org: EntitlementOrg = {
      plan: "reconciliation",
      complimentary: true,
      complimentaryUntil: "2026-09-30",
      complimentaryPlan: null,
      stripeStatus: null,
    };
    expect(orgEntitlement(org, "2026-10-01", true).paid).toBe(false);
    expect(orgEntitlement(org, "2026-09-30", true).paid).toBe(true);
    expect(orgEntitlement(org, "2026-09-29", true).paid).toBe(true);
  });
});

describe("activeFundingSourceLimit", () => {
  it("is unlimited while billing is off", () => {
    expect(activeFundingSourceLimit({ paid: true, plan: "reconciliation", reason: "billing_off" })).toBe(null);
  });

  it("follows the plan otherwise", () => {
    expect(activeFundingSourceLimit({ paid: true, plan: "reconciliation", reason: "subscription" })).toBe(1);
    expect(activeFundingSourceLimit({ paid: true, plan: "reconciliation_ai", reason: "complimentary" })).toBe(null);
    expect(activeFundingSourceLimit({ paid: false, plan: "reconciliation", reason: "new" })).toBe(1);
  });

  it("every reason × plan combination (U-4/U-21)", () => {
    const paidReasons: Array<"billing_off" | "complimentary" | "subscription"> = [
      "billing_off",
      "complimentary",
      "subscription",
    ];
    const unpaidReasons: Array<"new" | "ended" | "complimentary_ended" | "unknown_status"> = [
      "new",
      "ended",
      "complimentary_ended",
      "unknown_status",
    ];
    for (const plan of ["reconciliation", "reconciliation_ai"] as const) {
      for (const reason of paidReasons) {
        const limit = activeFundingSourceLimit({ paid: true, plan, reason });
        const expected = reason === "billing_off" ? null : plan === "reconciliation" ? 1 : null;
        expect(limit, `${reason}/${plan}`).toBe(expected);
      }
      // Unpaid orgs still get a limit computed from their (unpaid) plan — the caller decides
      // whether to even ask for it while unpaid; this function itself only special-cases billing_off.
      for (const reason of unpaidReasons) {
        const limit = activeFundingSourceLimit({ paid: false, plan, reason });
        expect(limit, `${reason}/${plan}`).toBe(plan === "reconciliation" ? 1 : null);
      }
    }
  });
});

describe("reconciliationStartsOn (P24): the day a queued downgrade to Reconciliation starts", () => {
  const now = new Date("2027-01-01T17:00:00Z");
  const queued = { pendingPlan: "reconciliation" as const, pendingReason: "downgrade", pendingAt: new Date("2027-02-01T05:00:00Z") };

  it("its start day, in Detroit", () => {
    expect(reconciliationStartsOn(queued, now)).toBe("2027-02-01");
  });

  it("late evening in Detroit is still that day there, though already the next day in UTC and in the test zone", () => {
    // 10 pm on 1 February in Detroit (UTC-5) is 3 am on 2 February in UTC and 8 am in Karachi.
    expect(reconciliationStartsOn({ ...queued, pendingAt: new Date("2027-02-02T03:00:00Z") }, now)).toBe("2027-02-01");
  });

  it.each([
    ["a price move, not a downgrade", { pendingReason: "price_move" }],
    ["already started", { pendingAt: new Date("2026-12-01T00:00:00Z") }],
    ["queued to Reconciliation + AI", { pendingPlan: "reconciliation_ai" as const }],
    ["nothing queued", { pendingPlan: null, pendingReason: null, pendingAt: null }],
  ])("not when %s", (_case, change) => {
    expect(reconciliationStartsOn({ ...queued, ...change }, now)).toBeNull();
  });
});
