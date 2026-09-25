import { describe, expect, it } from "vitest";

import {
  describeAccountEvent,
  parsePlanFilter,
  parseStatusFilter,
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

describe("staffBilling: the org page's Billing card (Phase 15 §4.6)", () => {
  const NOW = new Date("2026-09-25T16:00:00Z");
  const none: BillingCopy = {
    stripeCustomerId: null,
    stripeLivemode: null,
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
    billingFlag: null,
  };
  const paying: BillingCopy = {
    ...none,
    stripeCustomerId: "cus_123",
    stripeLivemode: false,
    stripeStatus: "active",
    billingInterval: "month",
    currentPeriodEnd: new Date("2026-10-25T16:00:00Z"),
  };

  it("nothing when Stripe has never seen the org", () => {
    expect(staffBilling(none, NOW)).toBeNull();
  });

  it("a healthy subscription: status, interval, renewal, a test-mode customer link, no warnings", () => {
    expect(staffBilling(paying, NOW)).toEqual({
      facts: [
        { label: "Stripe status", value: "active" },
        { label: "Billed", value: "monthly" },
        { label: "Renews on", value: expect.stringContaining("2026") },
      ],
      warnings: [],
      customerUrl: "https://dashboard.stripe.com/test/customers/cus_123",
    });
  });

  it("a live-mode customer links without /test/", () => {
    expect(staffBilling({ ...paying, stripeLivemode: true }, NOW)?.customerUrl).toBe(
      "https://dashboard.stripe.com/customers/cus_123",
    );
  });

  it("cancelling says Ends on; a cancelled one shows no date", () => {
    expect(staffBilling({ ...paying, cancelAtPeriodEnd: true }, NOW)?.facts.map((f) => f.label)).toContain("Ends on");
    const labels = staffBilling({ ...paying, stripeStatus: "canceled" }, NOW)?.facts.map((f) => f.label);
    expect(labels).not.toContain("Renews on");
    expect(labels).not.toContain("Ends on");
  });

  it("a queued downgrade and a queued price move read differently", () => {
    const at = new Date("2026-10-25T16:00:00Z");
    const down = staffBilling(
      { ...paying, pendingPlan: "reconciliation", pendingInterval: "year", pendingAt: at, pendingReason: "downgrade" },
      NOW,
    );
    expect(down?.facts.at(-1)?.value).toMatch(/^Reconciliation, billed yearly, on /);
    const move = staffBilling({ ...paying, pendingPlan: "reconciliation", pendingInterval: "month", pendingAt: at, pendingReason: "price_move" }, NOW);
    expect(move?.facts.at(-1)?.value).toMatch(/^Price change on /);
  });

  it("failed payment, upgrade waiting, paused collection and a dispute flag are warnings", () => {
    const b = staffBilling(
      {
        ...paying,
        stripeStatus: "past_due",
        upgradeExpiresAt: new Date(NOW.getTime() + 3600_000),
        collectionPaused: true,
        billingFlag: "dispute",
      },
      NOW,
    );
    expect(b?.warnings).toEqual([
      "Last payment failed. Stripe is retrying the card.",
      expect.stringMatching(/^Upgrade waiting for payment until /),
      "Collection paused while suspended.",
      "Stripe flagged this account: dispute.",
    ]);
  });

  it("an expired upgrade is not a warning", () => {
    expect(staffBilling({ ...paying, upgradeExpiresAt: new Date(NOW.getTime() - 1) }, NOW)?.warnings).toEqual([]);
  });

  it("the customer id is encoded into the link", () => {
    expect(staffBilling({ ...paying, stripeCustomerId: "cus_a/../b" }, NOW)?.customerUrl).toBe(
      "https://dashboard.stripe.com/test/customers/cus_a%2F..%2Fb",
    );
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

// complimentaryState moved to src/domain/complimentary.ts (Phase 15, P10); its tests moved to
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

  it("a row Stripe's sync wrote names Stripe, not Unknown (Phase 15 P15)", () => {
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