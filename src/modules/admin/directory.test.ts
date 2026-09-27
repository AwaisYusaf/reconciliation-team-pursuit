import { describe, expect, it } from "vitest";

import {
  describeAccountEvent,
  parsePlanFilter,
  parseStatusFilter,
  paymentStatusLabel,
  staffBilling,
  usersFooter,
  type AccountEvent,
  type BillingCopy,
  type DirectoryOrg,
} from "./directory";

// Type-level guard (Phase 9 §7 note): `queries.ts`'s row types must stay structurally
// assignable to `directory.ts`'s own re-declared types, or the two silently drift apart.
// `import type` is erased at runtime (isolatedModules), so this never drags `server-only`
// into this unit test.
import type { OrgAccountEventRow, OrgAccountRow, OrgDirectoryRow } from "./queries";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _directoryRowCheck: DirectoryOrg = {} as OrgDirectoryRow;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _accountEventCheck: AccountEvent = {} as OrgAccountEventRow;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _billingCopyCheck: BillingCopy = {} as OrgAccountRow;

describe("staffBilling: the org page's Billing card (Phase 16 §4.6)", () => {
  const NOW = new Date("2026-09-25T16:00:00Z");
  const none: BillingCopy = {
    stripeCustomerId: null,
    livemode: null,
    stripeStatus: null,
    billingInterval: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pendingPlan: null,
    pendingInterval: null,
    pendingAt: null,
    pendingReason: null,
    upgradeExpiresAt: null,
    collectionPaused: false,
    disputedAt: null,
  };
  const paying: BillingCopy = {
    ...none,
    stripeCustomerId: "cus_123",
    livemode: false,
    stripeStatus: "active",
    billingInterval: "month",
    currentPeriodEnd: new Date("2026-10-25T16:00:00Z"),
  };

  it("nothing when Stripe has never seen the org", () => {
    expect(staffBilling(none, null, NOW)).toBeNull();
  });

  const PAID = { amountCents: 49_700, at: new Date("2026-09-25T16:00:00Z") };

  it("paid: a green Paid pill with the last payment, then interval, renewal and last payment as facts", () => {
    expect(staffBilling(paying, PAID, NOW)).toEqual({
      headline: { tone: "good", label: "Paid", detail: expect.stringMatching(/^Last payment \$497\.00 on /) },
      facts: [
        { label: "Billed", value: "monthly" },
        { label: "Renews on", value: expect.stringContaining("2026") },
        { label: "Last payment", value: expect.stringMatching(/^\$497\.00 · /) },
      ],
      warnings: [],
      customerUrl: "https://dashboard.stripe.com/test/customers/cus_123",
    });
  });

  it("Total paid follows Last payment, with a note that refunds aren't taken off; $0.00 shows, unknown doesn't", () => {
    const facts = staffBilling(paying, PAID, NOW, 69_699)?.facts ?? [];
    expect(facts.map((f) => f.label)).toEqual(["Billed", "Renews on", "Last payment", "Total paid"]);
    expect(facts[3]).toEqual({ label: "Total paid", value: "$696.99", caption: "Every paid invoice, before any refunds." });

    expect(staffBilling(paying, null, NOW, 0)?.facts.at(-1)).toMatchObject({ label: "Total paid", value: "$0.00" });
    // Stripe couldn't be reached: no figure rather than a wrong $0.00.
    expect(staffBilling(paying, null, NOW, null)?.facts.map((f) => f.label)).not.toContain("Total paid");
  });

  it("active but no paid invoice read (Stripe unreachable): still Paid, no invented amount", () => {
    const b = staffBilling(paying, null, NOW);
    expect(b?.headline).toEqual({ tone: "good", label: "Paid", detail: null });
    expect(b?.facts.map((f) => f.label)).not.toContain("Last payment");
  });

  it.each(["past_due", "unpaid"])("%s: a red Payment failed pill, with the retry line", (status) => {
    expect(staffBilling({ ...paying, stripeStatus: status }, PAID, NOW)?.headline).toEqual({
      tone: "bad",
      label: "Payment failed",
      detail: "Last payment failed. Stripe is retrying the card.",
    });
  });

  it("trialing (bought during complimentary access): Not charged yet, with the first payment date", () => {
    const b = staffBilling({ ...paying, stripeStatus: "trialing" }, null, NOW);
    expect(b?.headline).toMatchObject({ tone: "neutral", label: "Not charged yet", detail: expect.stringMatching(/^Card saved\. The first payment is on /) });
    expect(b?.facts.map((f) => f.label)).toContain("First payment on");
  });

  it("cancelling: Paid, cancelling, with when access ends; the fact says Ends on", () => {
    const b = staffBilling({ ...paying, cancelAtPeriodEnd: true }, PAID, NOW);
    expect(b?.headline).toMatchObject({ tone: "warn", label: "Paid, cancelling", detail: expect.stringMatching(/^Won't renew\. Access ends on /) });
    expect(b?.facts.map((f) => f.label)).toContain("Ends on");
  });

  it.each(["canceled", "incomplete_expired"])("%s: Cancelled, and no renewal date", (status) => {
    const b = staffBilling({ ...paying, stripeStatus: status }, PAID, NOW);
    expect(b?.headline).toMatchObject({ tone: "neutral", label: "Cancelled" });
    const labels = b?.facts.map((f) => f.label);
    expect(labels).not.toContain("Renews on");
    expect(labels).not.toContain("Ends on");
  });

  it("incomplete: Payment not finished", () => {
    expect(staffBilling({ ...paying, stripeStatus: "incomplete" }, null, NOW)?.headline).toMatchObject({ tone: "warn", label: "Payment not finished" });
  });

  it("an unknown Stripe status is shown as is, never as Paid", () => {
    expect(staffBilling({ ...paying, stripeStatus: "some_future_status" }, null, NOW)?.headline).toMatchObject({
      tone: "neutral",
      label: "some_future_status",
    });
  });

  it("a customer with no subscription yet: No Stripe subscription", () => {
    expect(staffBilling({ ...none, stripeCustomerId: "cus_1", livemode: false }, null, NOW)?.headline.label).toBe(
      "No Stripe subscription.",
    );
  });

  it("a live-mode customer links without /test/", () => {
    expect(staffBilling({ ...paying, livemode: true }, null, NOW)?.customerUrl).toBe(
      "https://dashboard.stripe.com/customers/cus_123",
    );
  });

  it("a queued downgrade and a queued price move read differently", () => {
    const at = new Date("2026-10-25T16:00:00Z");
    const down = staffBilling(
      { ...paying, pendingPlan: "reconciliation", pendingInterval: "year", pendingAt: at, pendingReason: "downgrade" },
      null,
      NOW,
    );
    expect(down?.facts.at(-1)?.value).toMatch(/^Reconciliation, billed yearly, on /);
    const move = staffBilling(
      { ...paying, pendingPlan: "reconciliation", pendingInterval: "month", pendingAt: at, pendingReason: "price_move" },
      null,
      NOW,
    );
    expect(move?.facts.at(-1)?.value).toMatch(/^Price change on /);
  });

  it("upgrade waiting, paused collection and a card dispute are warnings (a failed payment is the pill)", () => {
    const b = staffBilling(
      {
        ...paying,
        upgradeExpiresAt: new Date(NOW.getTime() + 3600_000),
        collectionPaused: true,
        disputedAt: new Date("2026-09-20T16:00:00Z"),
      },
      null,
      NOW,
    );
    expect(b?.warnings).toEqual([
      expect.stringMatching(/^Upgrade waiting for payment until /),
      "Collection paused while suspended.",
      "Card dispute opened on 20 Sep 2026. Review it in Stripe.",
    ]);
  });

  it("an expired upgrade is not a warning", () => {
    expect(staffBilling({ ...paying, upgradeExpiresAt: new Date(NOW.getTime() - 1) }, null, NOW)?.warnings).toEqual([]);
  });

  it("the customer id is encoded into the link", () => {
    expect(staffBilling({ ...paying, stripeCustomerId: "cus_a/../b" }, null, NOW)?.customerUrl).toBe(
      "https://dashboard.stripe.com/test/customers/cus_a%2F..%2Fb",
    );
  });
});

describe("paymentStatusLabel", () => {
  it.each([
    ["paid", "Paid"],
    ["open", "Due"],
    ["void", "Cancelled"],
    ["uncollectible", "Not collected"],
    ["draft", "Draft"],
    ["something_new", "something_new"],
  ])("%s → %s", (status, label) => {
    expect(paymentStatusLabel(status)).toBe(label);
  });
});

describe("parsePlanFilter / parseStatusFilter (Phase 9 §6)", () => {
  it("accepts the real values", () => {
    expect(parsePlanFilter("reconciliation")).toBe("reconciliation");
    expect(parsePlanFilter("reconciliation_ai")).toBe("reconciliation_ai");
    expect(parseStatusFilter("trial")).toBe("trial");
    expect(parseStatusFilter("cancelled")).toBe("cancelled");
  });

  it("drops absent, empty and unknown values", () => {
    expect(parsePlanFilter(undefined)).toBeNull();
    expect(parsePlanFilter("")).toBeNull();
    expect(parsePlanFilter("gold")).toBeNull();
    expect(parseStatusFilter("paused")).toBeNull();
  });

  it("drops inherited object keys, which a `key in object` check would accept", () => {
    // `?plan=constructor` passed the old `in` check, was cast to an enum value and reached
    // Postgres, which rejects it as invalid enum input — a 500 from a hand-typed URL. Every
    // key here is `in PLAN_LABELS` but owned by Object.prototype, not by it.
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(parsePlanFilter(key)).toBeNull();
      expect(parseStatusFilter(key)).toBeNull();
    }
  });
});

describe("usersFooter (Phase 9 §6)", () => {
  it("shows nothing when every user is already on the page", () => {
    expect(usersFooter({ showAll: false, shown: 4, total: 4 })).toBe("none");
    expect(usersFooter({ showAll: true, shown: 4, total: 4 })).toBe("none");
    expect(usersFooter({ showAll: false, shown: 0, total: 0 })).toBe("none");
  });

  it("offers View all while there are more to fetch", () => {
    expect(usersFooter({ showAll: false, shown: 10, total: 13 })).toBe("view-all");
  });

  it("says the list is capped instead of linking to the page already open", () => {
    // Past ORG_USERS_MAX the old code rendered "View all" again, pointing at `?users=all` —
    // the page the reader was already on, so the link did nothing.
    expect(usersFooter({ showAll: true, shown: 200, total: 431 })).toBe("capped");
  });
});

// complimentaryState moved to src/domain/complimentary.ts (Phase 16, P10); its tests moved to
// src/domain/complimentary.test.ts.

describe("describeAccountEvent (Phase 9 §5)", () => {
  const base = {
    before: { plan: "reconciliation" as const, status: "trial" as const, complimentaryUntil: null },
    after: { plan: "reconciliation" as const, status: "trial" as const, complimentaryUntil: null },
    actorName: "Staff Person" as string | null,
    actorEmail: "staff@example.test" as string | null,
  };

  function event(overrides: Partial<AccountEvent>): AccountEvent {
    return { action: "plan_changed", ...base, ...overrides } as AccountEvent;
  }

  it("a row Stripe's sync wrote names Stripe, not Unknown (Phase 16 P15)", () => {
    const e = event({
      actorName: null,
      actorEmail: null,
      viaStripe: true,
      after: { ...base.after, status: "active" },
    });
    expect(describeAccountEvent(e)).toBe("Stripe changed status from Trial to Active");
    expect(describeAccountEvent({ ...e, viaStripe: false })).toBe("Unknown changed status from Trial to Active");
  });

  it("plan_changed: plan only", () => {
    const e = event({
      before: { ...base.before, plan: "reconciliation" },
      after: { ...base.after, plan: "reconciliation_ai" },
    });
    expect(describeAccountEvent(e)).toBe("Staff Person changed plan from Reconciliation to Reconciliation + AI");
  });

  it("plan_changed: status only", () => {
    const e = event({
      before: { ...base.before, status: "trial" },
      after: { ...base.after, status: "active" },
    });
    expect(describeAccountEvent(e)).toBe("Staff Person changed status from Trial to Active");
  });

  it("plan_changed: both plan and status", () => {
    const e = event({
      before: { ...base.before, plan: "reconciliation", status: "trial" },
      after: { ...base.after, plan: "reconciliation_ai", status: "active" },
    });
    expect(describeAccountEvent(e)).toBe(
      "Staff Person changed plan from Reconciliation to Reconciliation + AI and status from Trial to Active",
    );
  });

  it("complimentary_granted with and without an end date", () => {
    expect(describeAccountEvent(event({ action: "complimentary_granted" }))).toBe(
      "Staff Person gave complimentary access",
    );
    expect(
      describeAccountEvent(
        event({ action: "complimentary_granted", after: { ...base.after, complimentaryUntil: "2027-06-30" } }),
      ),
    ).toBe("Staff Person gave complimentary access until 30 Jun 2027");
  });

  it("complimentary_changed to a date and to no end date", () => {
    expect(
      describeAccountEvent(
        event({ action: "complimentary_changed", after: { ...base.after, complimentaryUntil: "2027-01-15" } }),
      ),
    ).toBe("Staff Person changed complimentary access to end 15 Jan 2027");
    expect(describeAccountEvent(event({ action: "complimentary_changed" }))).toBe(
      "Staff Person changed complimentary access to no end date",
    );
  });

  it("complimentary_removed", () => {
    expect(describeAccountEvent(event({ action: "complimentary_removed" }))).toBe(
      "Staff Person removed complimentary access",
    );
  });

  it("suspended", () => {
    expect(describeAccountEvent(event({ action: "suspended" }))).toBe("Staff Person suspended access");
  });

  it("reinstated", () => {
    expect(describeAccountEvent(event({ action: "reinstated" }))).toBe("Staff Person reinstated access");
  });

  it("actor falls back to email when actorName is null", () => {
    const e = event({ action: "suspended", actorName: null, actorEmail: "person@example.test" });
    expect(describeAccountEvent(e)).toBe("person@example.test suspended access");
  });

  it("actorEmail null (deleted staff account) renders the actor as 'Unknown'", () => {
    const e = event({ action: "suspended", actorName: "Someone", actorEmail: null });
    expect(describeAccountEvent(e)).toBe("Unknown suspended access");
  });
});