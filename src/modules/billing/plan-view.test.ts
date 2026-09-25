/**
 * U-14: every Plan & billing state (Phase 15 §4.3), as the pure view, plus a source check that
 * the section renders each state's text and actions.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COMP_WARNING_DAYS, planBillingView, type PlanBillingRow } from "./plan-view";

// Noon in Detroit, so `todayIso` is unambiguous.
const NOW = new Date("2026-09-25T16:00:00Z");
const DAY = 86_400_000;
const on = { billingOn: true, now: NOW };

const base: PlanBillingRow = {
  plan: "reconciliation",
  complimentary: false,
  complimentaryUntil: null,
  complimentaryPlan: null,
  stripeStatus: "active",
  billingInterval: "month",
  currentPeriodEnd: new Date("2026-10-25T16:00:00Z"),
  cancelAtPeriodEnd: false,
  pendingPlan: null,
  pendingInterval: null,
  pendingAt: null,
  pendingReason: null,
  upgradePayUrl: null,
  upgradeExpiresAt: null,
};
const row = (over: Partial<PlanBillingRow>): PlanBillingRow => ({ ...base, ...over });

describe("planBillingView", () => {
  it("billing off: off, whatever the row says", () => {
    expect(planBillingView(base, { billingOn: false, now: NOW })).toEqual({ kind: "off" });
    expect(planBillingView(row({ complimentary: true }), { billingOn: false, now: NOW })).toEqual({ kind: "off" });
  });

  it("healthy subscription: plan, interval, renewal, nothing else", () => {
    expect(planBillingView(base, on)).toEqual({
      kind: "subscribed",
      plan: "reconciliation",
      interval: "month",
      periodEnd: "2026-10-25",
      cancelling: false,
      paymentFailed: false,
      pending: null,
      upgrade: null,
    });
  });

  it("cancelling: flagged, period end is the last day of access", () => {
    const view = planBillingView(row({ cancelAtPeriodEnd: true }), on);
    expect(view).toMatchObject({ kind: "subscribed", cancelling: true, periodEnd: "2026-10-25" });
  });

  it("queued downgrade and queued price move", () => {
    const at = new Date(NOW.getTime() + 10 * DAY);
    const down = planBillingView(
      row({ plan: "reconciliation_ai", pendingPlan: "reconciliation", pendingInterval: "month", pendingAt: at, pendingReason: "downgrade" }),
      on,
    );
    expect(down).toMatchObject({ pending: { kind: "downgrade", plan: "reconciliation", interval: "month", at: "2026-10-05" } });

    const move = planBillingView(
      row({ pendingPlan: "reconciliation", pendingInterval: "month", pendingAt: at, pendingReason: "price_move" }),
      on,
    );
    expect(move).toMatchObject({ pending: { kind: "price_move" } });
  });

  it("a queued change already past, or with a bad plan or interval, is not shown", () => {
    const past = new Date(NOW.getTime() - DAY);
    expect(planBillingView(row({ pendingPlan: "reconciliation", pendingInterval: "month", pendingAt: past }), on)).toMatchObject({ pending: null });
    const future = new Date(NOW.getTime() + DAY);
    expect(planBillingView(row({ pendingPlan: "reconciliation", pendingInterval: "week", pendingAt: future }), on)).toMatchObject({ pending: null });
  });

  it("upgrade waiting for payment: shown until it expires", () => {
    const live = planBillingView(row({ upgradePayUrl: "https://invoice.stripe.com/i/x", upgradeExpiresAt: new Date(NOW.getTime() + 3600_000) }), on);
    expect(live).toMatchObject({ upgrade: { payUrl: "https://invoice.stripe.com/i/x" } });
    const expired = planBillingView(row({ upgradePayUrl: "https://invoice.stripe.com/i/x", upgradeExpiresAt: new Date(NOW.getTime() - 1) }), on);
    expect(expired).toMatchObject({ upgrade: null });
  });

  it.each(["past_due", "unpaid"])("payment failed (%s) wins: hides the queued change and the upgrade", (status) => {
    const view = planBillingView(
      row({
        stripeStatus: status,
        pendingPlan: "reconciliation",
        pendingInterval: "month",
        pendingAt: new Date(NOW.getTime() + DAY),
        upgradePayUrl: "https://invoice.stripe.com/i/x",
        upgradeExpiresAt: new Date(NOW.getTime() + DAY),
      }),
      on,
    );
    expect(view).toMatchObject({ kind: "subscribed", paymentFailed: true, pending: null, upgrade: null });
  });

  it.each([null, "canceled", "incomplete", "incomplete_expired", "something_new"])("status %s: no plan", (status) => {
    expect(planBillingView(row({ stripeStatus: status }), on)).toEqual({ kind: "none" });
  });

  it("complimentary wins over a subscription, and shows the complimentary plan", () => {
    const view = planBillingView(
      row({ complimentary: true, complimentaryPlan: "reconciliation_ai", stripeStatus: null }),
      on,
    );
    expect(view).toEqual({
      kind: "complimentaryAccess",
      plan: "reconciliation_ai",
      until: null,
      endingSoon: false,
      buy: { kind: "now" },
      upcoming: null,
    });
  });

  it("complimentary with an end date far enough out: buying defers the first charge to the day after it", () => {
    const view = planBillingView(row({ complimentary: true, complimentaryUntil: "2026-10-10", stripeStatus: null }), on);
    expect(view).toMatchObject({ buy: { kind: "defer", firstChargeOn: "2026-10-11" }, upcoming: null });
  });

  it("complimentary ending tomorrow: too soon to defer, buying charges now", () => {
    const view = planBillingView(row({ complimentary: true, complimentaryUntil: "2026-09-26", stripeStatus: null }), on);
    expect(view).toMatchObject({ buy: { kind: "now" } });
  });

  it("a plan bought during complimentary access shows as upcoming, with its start date", () => {
    const view = planBillingView(
      row({
        complimentary: true,
        complimentaryUntil: "2026-10-10",
        complimentaryPlan: "reconciliation_ai",
        plan: "reconciliation",
        stripeStatus: "trialing",
        billingInterval: "year",
        currentPeriodEnd: new Date("2026-10-11T04:00:00Z"),
      }),
      on,
    );
    expect(view).toMatchObject({
      kind: "complimentaryAccess",
      plan: "reconciliation_ai",
      upcoming: { plan: "reconciliation", interval: "year", startsOn: "2026-10-11", cancelling: false },
    });
  });

  it("an upcoming plan that was cancelled is flagged, so the section offers Keep my plan", () => {
    const view = planBillingView(
      row({ complimentary: true, stripeStatus: "trialing", cancelAtPeriodEnd: true }),
      on,
    );
    expect(view).toMatchObject({ upcoming: { cancelling: true } });
  });

  it(`complimentary ending: warned from ${COMP_WARNING_DAYS} days out, not 15`, () => {
    const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString().slice(0, 10) as PlanBillingRow["complimentaryUntil"];
    expect(planBillingView(row({ complimentary: true, complimentaryUntil: at(COMP_WARNING_DAYS) }), on)).toMatchObject({ endingSoon: true });
    expect(planBillingView(row({ complimentary: true, complimentaryUntil: at(0) }), on)).toMatchObject({ endingSoon: true });
    expect(planBillingView(row({ complimentary: true, complimentaryUntil: at(COMP_WARNING_DAYS + 1) }), on)).toMatchObject({ endingSoon: false });
  });

  it("complimentary that has ended falls through to the subscription (or none)", () => {
    const view = planBillingView(row({ complimentary: true, complimentaryUntil: "2026-09-01", stripeStatus: null }), on);
    expect(view).toEqual({ kind: "none" });
  });
});

describe("Plan & billing section renders each state", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../../app/r/settings/plan-billing-section.tsx", import.meta.url)),
    "utf8",
  );

  it.each([
    ["off", ["UI.billingNotEnabled"]],
    ["none", ["UI.billingNoPlan", "<SubscribeButton", "UI.billingManagerNote"]],
    ["complimentary", ["UI.billingComplimentaryUntil", "UI.billingComplimentary(", "UI.billingCompBuyDeferred", "UI.billingCompBuyNow", "UI.billingQuestions"]],
    ["complimentary with a plan bought", ["UI.billingCompUpcoming(", "UI.billingCompUpcomingCancelled", "UI.billingCancelUpcomingBody"]],
    ["subscribed", ["UI.billingRenews", "UI.billingCancelling", "UI.billingSwitchPlan", "UI.billingPortal", "UI.billingCancelPlan"]],
    ["plans", ["<PlanCards", "UI.billingPlansTitle", "UI.billingYourPlan"]],
    ["switch refused", ["UI.billingPaymentFailedRefused", "UI.billingCancelPending", "UI.billingPaymentPending", "UI.billingChangePending"]],
    ["cancelling", ["UI.billingKeepPlan", "resumePlanAction"]],
    ["payment failed", ["UI.billingPaymentFailed", "UI.billingPaymentFailedManager", "UI.billingEndNow", "endPlanNowAction"]],
    ["queued change", ["UI.billingDowngradeQueued", "UI.billingPriceMoveQueued", "UI.billingCancelChange", "cancelPendingChangeAction"]],
    ["upgrade waiting", ["UI.billingUpgradeWaiting", "UI.billingPayNow"]],
  ])("%s", (_state, needles) => {
    for (const needle of needles) expect(source, needle).toContain(needle);
  });

  it("the complimentary ending warning is the page banner only, never repeated in the section", () => {
    expect(source).not.toContain("UI.billingCompEnding");
  });

  it("a manager gets no plan buttons: the card actions stop for anyone but an admin", () => {
    const fn = source.slice(source.indexOf("function planActions"), source.indexOf("return (", source.indexOf("function planActions") + 400));
    expect(fn).toContain("if (!isAdmin) return null;");
  });

  it("the Cancel this change button is for a downgrade only, never a price move", () => {
    const i = source.indexOf("UI.billingCancelChange");
    expect(source.slice(i - 400, i)).toContain('view.pending.kind === "downgrade" && isAdmin');
  });
});
