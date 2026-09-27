/**
 * PHASE-16 U-17/U-20 (unit): `sharesAllowed`, `hasPaidAccess` and `complimentaryEndedOn`
 * — pure, no database. `orgEntitlement` itself is exhaustively covered by
 * `src/modules/billing/entitlement.test.ts` (U-4/U-21); this file covers the three readers
 * layered on top of it in `src/services/auth/entitlement.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EntitlementRow } from "./entitlement";
import { complimentaryEndedOn, hasPaidAccess, sharesAllowed } from "./entitlement";

const base: EntitlementRow = {
  plan: "reconciliation",
  complimentary: false,
  complimentaryUntil: null,
  complimentaryPlan: null,
  stripeStatus: null,
  subscriptionStatus: "active",
};

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("sharesAllowed (AC-N3, PHASE-12 C4)", () => {
  it("billing off: keeps today's rule exactly — a 'cancelled' subscriptionStatus refuses", () => {
    vi.stubEnv("BILLING_ENABLED", "false");
    expect(sharesAllowed({ ...base, subscriptionStatus: "cancelled" })).toBe(false);
  });

  it("billing off: any other subscriptionStatus (including null) still opens the link", () => {
    vi.stubEnv("BILLING_ENABLED", "false");
    expect(sharesAllowed({ ...base, subscriptionStatus: "active" })).toBe(true);
    expect(sharesAllowed({ ...base, subscriptionStatus: "trial" })).toBe(true);
  });

  it("billing on, paid: opens even when the leftover subscriptionStatus column still says cancelled", () => {
    vi.stubEnv("BILLING_ENABLED", "true");
    expect(
      sharesAllowed({ ...base, stripeStatus: "active", subscriptionStatus: "cancelled" }),
    ).toBe(true);
  });

  it("billing on, unpaid: refuses regardless of subscriptionStatus", () => {
    vi.stubEnv("BILLING_ENABLED", "true");
    expect(
      sharesAllowed({ ...base, stripeStatus: "canceled", subscriptionStatus: "active" }),
    ).toBe(false);
  });

  it("billing on, complimentary now: opens", () => {
    vi.stubEnv("BILLING_ENABLED", "true");
    expect(
      sharesAllowed({ ...base, complimentary: true, complimentaryUntil: null, subscriptionStatus: "cancelled" }),
    ).toBe(true);
  });
});

describe("hasPaidAccess (fails closed)", () => {
  it("uses the session's own entitlement when present, paid or not", () => {
    expect(hasPaidAccess({ entitlement: { paid: true, plan: "reconciliation", reason: "subscription" } })).toBe(true);
    expect(hasPaidAccess({ entitlement: { paid: false, plan: "reconciliation", reason: "ended" } })).toBe(false);
  });

  it("no entitlement on the session, billing off -> treated as paid (today's behaviour)", () => {
    vi.stubEnv("BILLING_ENABLED", "false");
    expect(hasPaidAccess({})).toBe(true);
    expect(hasPaidAccess({ entitlement: undefined })).toBe(true);
  });

  it("no entitlement on the session, billing on -> fails closed, not assumed paid", () => {
    vi.stubEnv("BILLING_ENABLED", "true");
    expect(hasPaidAccess({})).toBe(false);
  });
});

describe("complimentaryEndedOn", () => {
  it("returns the column, whatever it is", () => {
    expect(complimentaryEndedOn({ complimentaryUntil: "2026-01-01" })).toBe("2026-01-01");
    expect(complimentaryEndedOn({ complimentaryUntil: null })).toBeNull();
  });
});
