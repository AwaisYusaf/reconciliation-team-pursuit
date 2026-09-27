import { describe, expect, it } from "vitest";

import { UI } from "@/src/domain/strings";
import type { Entitlement } from "@/src/modules/billing/entitlement";
import { fundingSourceLimitRefusal } from "@/src/modules/funding-sources/limit";

function ent(overrides: Partial<Entitlement> = {}): Entitlement {
  return { paid: true, plan: "reconciliation", reason: "subscription", ...overrides } as Entitlement;
}

describe("fundingSourceLimitRefusal", () => {
  it("never refuses while billing is off, any count", () => {
    const billingOff = ent({ reason: "billing_off" });
    expect(fundingSourceLimitRefusal({ entitlement: billingOff, activeOthers: 0, role: "admin" })).toBeNull();
    expect(fundingSourceLimitRefusal({ entitlement: billingOff, activeOthers: 5, role: "admin" })).toBeNull();
  });

  it("never refuses while billing is off even with a queued downgrade date", () => {
    const billingOff = ent({ reason: "billing_off" });
    expect(
      fundingSourceLimitRefusal({
        entitlement: billingOff,
        activeOthers: 5,
        role: "admin",
        queuedDowngradeAt: "2026-10-01",
      }),
    ).toBeNull();
  });

  it("allows the first source on Reconciliation (activeOthers 0)", () => {
    expect(
      fundingSourceLimitRefusal({ entitlement: ent({ plan: "reconciliation" }), activeOthers: 0, role: "admin" }),
    ).toBeNull();
  });

  it("refuses at 1 active on Reconciliation", () => {
    expect(
      fundingSourceLimitRefusal({ entitlement: ent({ plan: "reconciliation" }), activeOthers: 1, role: "admin" }),
    ).toBe(UI.fundingSourceLimitReached);
  });

  it("refuses at 5 active on Reconciliation (above the limit, not just at it)", () => {
    expect(
      fundingSourceLimitRefusal({ entitlement: ent({ plan: "reconciliation" }), activeOthers: 5, role: "admin" }),
    ).toBe(UI.fundingSourceLimitReached);
  });

  it("gives the exact admin text", () => {
    expect(
      fundingSourceLimitRefusal({ entitlement: ent({ plan: "reconciliation" }), activeOthers: 1, role: "admin" }),
    ).toBe("Reconciliation includes one active funding source. To add more, try Plus.");
  });

  it("gives the exact manager text, distinct from the admin text", () => {
    const message = fundingSourceLimitRefusal({
      entitlement: ent({ plan: "reconciliation" }),
      activeOthers: 1,
      role: "manager",
    });
    expect(message).toBe("Reconciliation includes one active funding source. Ask your admin about upgrading.");
    expect(message).not.toBe(UI.fundingSourceLimitReached);
  });

  it("Reconciliation + AI is unlimited (no refusal at a high count)", () => {
    expect(
      fundingSourceLimitRefusal({
        entitlement: ent({ plan: "reconciliation_ai" }),
        activeOthers: 20,
        role: "admin",
      }),
    ).toBeNull();
  });

  it("an unpaid entitlement still applies its plan's limit", () => {
    const unpaid = ent({ paid: false, plan: "reconciliation", reason: "ended" });
    expect(fundingSourceLimitRefusal({ entitlement: unpaid, activeOthers: 1, role: "admin" })).toBe(
      UI.fundingSourceLimitReached,
    );
  });

  describe("queuedDowngradeAt", () => {
    it("on reconciliation_ai with 1 other active, returns the queued text with the formatted date", () => {
      const message = fundingSourceLimitRefusal({
        entitlement: ent({ plan: "reconciliation_ai" }),
        activeOthers: 1,
        role: "admin",
        queuedDowngradeAt: "2026-10-01",
      });
      expect(message).toBe(UI.fundingSourceLimitQueued("10/1/2026"));
      expect(message).toContain("10/1/2026");
    });

    it("on reconciliation_ai with 0 others active, allows it (null)", () => {
      expect(
        fundingSourceLimitRefusal({
          entitlement: ent({ plan: "reconciliation_ai" }),
          activeOthers: 0,
          role: "admin",
          queuedDowngradeAt: "2026-10-01",
        }),
      ).toBeNull();
    });

    it("does nothing on Reconciliation itself (its own limit already refuses first)", () => {
      const message = fundingSourceLimitRefusal({
        entitlement: ent({ plan: "reconciliation" }),
        activeOthers: 1,
        role: "admin",
        queuedDowngradeAt: "2026-10-01",
      });
      // Still refused, but by the ordinary Reconciliation limit, not the queued-downgrade branch.
      expect(message).toBe(UI.fundingSourceLimitReached);
    });
  });
});
