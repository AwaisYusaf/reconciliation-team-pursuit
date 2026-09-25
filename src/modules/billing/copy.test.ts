// U-7/U-9 (Phase 15 §3, §8.1): `copyOf` and `currentSubscription` are pure — no DB, no Stripe
// call — so they're tested with minimal hand-built fake `Stripe.Subscription` objects, cast
// through `as unknown as Stripe.Subscription` the way the task brief specifies.
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copyOf, currentSubscription, endsComplimentaryAt, NO_PENDING, NOT_AWAITING, type PendingChange, type AwaitingPayment } from "./sync";

type FakeSubOpts = {
  id?: string;
  status?: string;
  created?: number;
  plan?: string | null; // undefined → default "reconciliation"; null → metadata key absent
  interval?: string | null; // undefined → default "month"; null → recurring absent
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: number | null;
  pauseCollection?: object | null;
};

const DEFAULT_PERIOD_END = 1_700_000_000;

function fakeSub(opts: FakeSubOpts = {}): Stripe.Subscription {
  const currentPeriodEnd = opts.currentPeriodEnd ?? DEFAULT_PERIOD_END;
  const metadata = opts.plan === null ? {} : { plan: opts.plan ?? "reconciliation" };
  const recurring = opts.interval === null ? null : { interval: opts.interval ?? "month" };
  return {
    id: opts.id ?? "sub_1",
    status: opts.status ?? "active",
    created: opts.created ?? 1_600_000_000,
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    cancel_at: opts.cancelAt ?? null,
    pause_collection: opts.pauseCollection ?? null,
    schedule: null,
    pending_update: null,
    latest_invoice: null,
    items: {
      data: [
        {
          price: { id: "price_1", metadata, recurring },
          current_period_end: currentPeriodEnd,
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

const NP: PendingChange = NO_PENDING;
const NA: AwaitingPayment = NOT_AWAITING;

describe("copyOf: status mapping", () => {
  it("trialing -> trial", () => {
    expect(copyOf(fakeSub({ status: "trialing" }), NP, NA, null).subscriptionStatus).toBe("trial");
  });
  it("active -> active", () => {
    expect(copyOf(fakeSub({ status: "active" }), NP, NA, null).subscriptionStatus).toBe("active");
  });
  it("past_due -> past_due", () => {
    expect(copyOf(fakeSub({ status: "past_due" }), NP, NA, null).subscriptionStatus).toBe("past_due");
  });
  it("unpaid -> past_due", () => {
    expect(copyOf(fakeSub({ status: "unpaid" }), NP, NA, null).subscriptionStatus).toBe("past_due");
  });
  it("canceled -> cancelled", () => {
    // previousStatus live so writeStatus is true even though the new status itself is dead.
    expect(copyOf(fakeSub({ status: "canceled" }), NP, NA, "active").subscriptionStatus).toBe("cancelled");
  });
  it("incomplete_expired -> cancelled", () => {
    expect(copyOf(fakeSub({ status: "incomplete_expired" }), NP, NA, "active").subscriptionStatus).toBe("cancelled");
  });
});

describe("copyOf: plan is only ever written for a live status", () => {
  it("a live status (active) writes plan", () => {
    const copy = copyOf(fakeSub({ status: "active", plan: "reconciliation_ai" }), NP, NA, null);
    expect(copy.plan).toBe("reconciliation_ai");
  });
  it("a dead status (canceled) never writes plan, even coming from a live previous status", () => {
    const copy = copyOf(fakeSub({ status: "canceled", plan: "reconciliation_ai" }), NP, NA, "active");
    expect(copy.plan).toBeUndefined();
  });
});

describe("copyOf: dead subscription and subscriptionStatus (P27)", () => {
  it("previousStatus was live: a dead sub writes subscriptionStatus once, on the way from live to dead", () => {
    const copy = copyOf(fakeSub({ status: "canceled" }), NP, NA, "active");
    expect(copy.subscriptionStatus).toBe("cancelled");
    expect(copy.plan).toBeUndefined();
  });
  it("previousStatus was already dead: a dead sub writes neither subscriptionStatus nor plan again", () => {
    const copy = copyOf(fakeSub({ status: "canceled" }), NP, NA, "canceled");
    expect(copy.subscriptionStatus).toBeUndefined();
    expect(copy.plan).toBeUndefined();
  });
  it("previousStatus null (never synced) counts as not live: no subscriptionStatus written for a dead sub", () => {
    const copy = copyOf(fakeSub({ status: "canceled" }), NP, NA, null);
    expect(copy.subscriptionStatus).toBeUndefined();
  });
});

describe("copyOf: unknown Stripe status", () => {
  it("is stored as-is and logged ALERT rather than crashing", () => {
    const copy = copyOf(fakeSub({ status: "some_future_status" }), NP, NA, null);
    expect(copy.stripeStatus).toBe("some_future_status");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ALERT"));
  });
});

describe("copyOf: metadata.plan missing or invalid", () => {
  it("missing metadata.plan entirely: no plan written, ALERT logged", () => {
    const copy = copyOf(fakeSub({ status: "active", plan: null }), NP, NA, null);
    expect(copy.plan).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ALERT"));
  });
  it("invalid metadata.plan value: no plan written, ALERT logged", () => {
    const copy = copyOf(fakeSub({ status: "active", plan: "not_a_real_plan" }), NP, NA, null);
    expect(copy.plan).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ALERT"));
  });
});

describe("copyOf: cancellation timing", () => {
  it("cancel_at_period_end true with no cancel_at: cancelling, currentPeriodEnd is the item's period end", () => {
    const copy = copyOf(fakeSub({ cancelAtPeriodEnd: true, currentPeriodEnd: DEFAULT_PERIOD_END }), NP, NA, null);
    expect(copy.cancelAtPeriodEnd).toBe(true);
    expect(copy.currentPeriodEnd).toEqual(new Date(DEFAULT_PERIOD_END * 1000));
  });

  it("cancel_at within the current period: cancelling, currentPeriodEnd = cancel_at", () => {
    const cancelAt = DEFAULT_PERIOD_END - 1000; // before the period end
    const copy = copyOf(fakeSub({ cancelAt, currentPeriodEnd: DEFAULT_PERIOD_END }), NP, NA, null);
    expect(copy.cancelAtPeriodEnd).toBe(true);
    expect(copy.currentPeriodEnd).toEqual(new Date(cancelAt * 1000));
  });

  it("cancel_at beyond the current period (dashboard cancel further out): not cancelling, currentPeriodEnd = item's period end (renews first)", () => {
    const cancelAt = DEFAULT_PERIOD_END + 1000; // after the period end
    const copy = copyOf(fakeSub({ cancelAt, currentPeriodEnd: DEFAULT_PERIOD_END }), NP, NA, null);
    expect(copy.cancelAtPeriodEnd).toBe(false);
    expect(copy.currentPeriodEnd).toEqual(new Date(DEFAULT_PERIOD_END * 1000));
  });

  it("cancel_at exactly equal to the period end counts as within the period (cancelling)", () => {
    const copy = copyOf(fakeSub({ cancelAt: DEFAULT_PERIOD_END, currentPeriodEnd: DEFAULT_PERIOD_END }), NP, NA, null);
    expect(copy.cancelAtPeriodEnd).toBe(true);
    expect(copy.currentPeriodEnd).toEqual(new Date(DEFAULT_PERIOD_END * 1000));
  });
});

describe("copyOf: pause_collection", () => {
  it("present -> collectionPaused true", () => {
    const copy = copyOf(fakeSub({ pauseCollection: { behavior: "void" } }), NP, NA, null);
    expect(copy.collectionPaused).toBe(true);
  });
  it("null -> collectionPaused false", () => {
    const copy = copyOf(fakeSub({ pauseCollection: null }), NP, NA, null);
    expect(copy.collectionPaused).toBe(false);
  });
});

describe("copyOf: undefined subscription", () => {
  it("returns an all-null/false copy, and never touches pending/awaiting inputs' identity", () => {
    const copy = copyOf(undefined, NP, NA, null);
    expect(copy).toEqual({
      stripeSubscriptionId: null,
      stripeStatus: null,
      billingInterval: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      pendingPlan: null,
      pendingInterval: null,
      pendingAt: null,
      pendingReason: null,
      upgradePayUrl: null,
      upgradeExpiresAt: null,
      collectionPaused: false,
    });
    expect(copy.plan).toBeUndefined();
    expect(copy.subscriptionStatus).toBeUndefined();
  });

  it.each(["active", "trialing", "past_due", "unpaid", "paused"])(
    "customer deleted while %s: writes subscriptionStatus cancelled once, never plan",
    (previous) => {
      const copy = copyOf(undefined, NP, NA, previous);
      expect(copy.subscriptionStatus).toBe("cancelled");
      expect(copy.plan).toBeUndefined();
    },
  );

  it.each([null, "canceled", "incomplete", "incomplete_expired"])(
    "already not live (%s): leaves subscriptionStatus alone, so a staff edit after it lapsed stays",
    (previous) => {
      expect(copyOf(undefined, NP, NA, previous).subscriptionStatus).toBeUndefined();
    },
  );
});

describe("currentSubscription", () => {
  it("no subscriptions: returns undefined, no ALERT", () => {
    expect(currentSubscription("cus_1", [])).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("a single live subscription: returned, no ALERT", () => {
    const sub = fakeSub({ status: "active" });
    expect(currentSubscription("cus_1", [sub])).toBe(sub);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("two live subscriptions: ALERT logged and the newest (by created) live one is picked", () => {
    const older = fakeSub({ id: "sub_old", status: "active", created: 1_000 });
    const newer = fakeSub({ id: "sub_new", status: "trialing", created: 2_000 });
    const result = currentSubscription("cus_1", [older, newer]);
    expect(result?.id).toBe("sub_new");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ALERT"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("cus_1"));
  });
});

describe("endsComplimentaryAt (bought during complimentary access, charged today)", () => {
  const marked = (status: string) =>
    ({ ...fakeSub({ status, created: 1_700_000_000 }), metadata: { endComplimentary: "on_payment" } }) as Stripe.Subscription;

  it("an active, marked subscription ends the free access; returns when it was created", () => {
    expect(endsComplimentaryAt(marked("active"))).toEqual(new Date(1_700_000_000_000));
  });

  it.each(["incomplete", "trialing", "past_due", "canceled"])("not paid yet or not live (%s): nothing ends", (status) => {
    expect(endsComplimentaryAt(marked(status))).toBeNull();
  });

  it("an unmarked subscription, or none, never ends complimentary access", () => {
    expect(endsComplimentaryAt(fakeSub({ status: "active" }))).toBeNull();
    expect(endsComplimentaryAt(undefined)).toBeNull();
  });
});
