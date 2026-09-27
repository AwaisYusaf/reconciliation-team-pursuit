/**
 * Pure `/a` directory logic (Phase 9 §3.9, §5, Phase 3): the filter/search predicate, the
 * summary counts built from that same predicate, and the History sentence. No `db` import and
 * no `server-only` — this module is also used by a client component (Phase 4).
 */
import type { IsoDate } from "@/src/domain/dates";
import { formatDateShort, formatDateTimeShort, todayIso } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { PLAN_LABELS, STATUS_LABELS, UI } from "@/src/domain/strings";
import { userDisplay } from "@/src/domain/user-display";

export type OrgPlan = keyof typeof PLAN_LABELS;
export type SubscriptionStatus = keyof typeof STATUS_LABELS;

/** Structural shape every directory/org row satisfies — matches `queries.ts`'s row types. */
export type DirectoryOrg = {
  id: string;
  name: string;
  plan: OrgPlan;
  subscriptionStatus: SubscriptionStatus;
  complimentary: boolean;
  complimentaryUntil: IsoDate | null;
  suspendedAt: Date | null;
};

/**
 * A `?plan=` / `?status=` value from the URL, or null when it is anything else.
 *
 * `Object.hasOwn`, never `key in object`: `in` walks the prototype chain, so `?plan=constructor`,
 * `?plan=__proto__` and `?status=toString` all passed a `key in PLAN_LABELS` check, were cast to
 * an enum value and reached Postgres, which rejects them as invalid enum input — a 500 from a
 * hand-typed URL. Anything unrecognised is simply dropped, the same as an absent filter.
 */
export function parsePlanFilter(value: string | undefined): OrgPlan | null {
  return value && Object.hasOwn(PLAN_LABELS, value) ? (value as OrgPlan) : null;
}

export function parseStatusFilter(value: string | undefined): SubscriptionStatus | null {
  return value && Object.hasOwn(STATUS_LABELS, value) ? (value as SubscriptionStatus) : null;
}

export type UsersFooter = "none" | "view-all" | "capped";

/**
 * What to show under an organization's users table.
 *
 * `capped` is the case the first version got wrong: past `ORG_USERS_MAX` the "View all" link
 * reappeared on the page it already linked to, so clicking it did nothing. Past the ceiling the
 * reader is told the list stops instead.
 */
export function usersFooter({
  showAll,
  shown,
  total,
}: {
  showAll: boolean;
  shown: number;
  total: number;
}): UsersFooter {
  if (total <= shown) return "none";
  return showAll ? "capped" : "view-all";
}

// Searching, filtering, counting and paging used to live here as pure functions over an
// already-fetched array. They are gone: the directory now narrows in SQL (`queries.ts`), so a
// search covers every organization rather than whichever page the browser happened to hold.
// What remains here is what is genuinely pure — how a badge reads, and how an event reads.

/** The `loadOrgHistory` row shape this needs — structurally typed, not imported from `queries.ts`. */
export type AccountEvent = {
  action: "plan_changed" | "complimentary_granted" | "complimentary_changed" | "complimentary_removed" | "suspended" | "reinstated";
  before: { plan: OrgPlan; status: SubscriptionStatus; complimentaryUntil: IsoDate | null };
  after: { plan: OrgPlan; status: SubscriptionStatus; complimentaryUntil: IsoDate | null };
  actorName: string | null;
  actorEmail: string | null;
  /** Written by Stripe's sync, not a staff action (Phase 16 P15). */
  viaStripe?: boolean;
};

/** The org page's copy of Stripe's state — structurally typed, like `AccountEvent`. */
export type BillingCopy = {
  stripeCustomerId: string | null;
  livemode: boolean | null;
  stripeStatus: string | null;
  billingInterval: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pendingPlan: OrgPlan | null;
  pendingInterval: string | null;
  pendingAt: Date | null;
  pendingReason: string | null;
  upgradeExpiresAt: Date | null;
  collectionPaused: boolean;
  disputedAt: Date | null;
};

export type StaffBillingTone = "good" | "warn" | "bad" | "neutral";

export type StaffBilling = {
  /** Has this org paid? One pill and one line, answered first. */
  headline: { tone: StaffBillingTone; label: string; detail: string | null };
  facts: { label: string; value: string; caption?: string }[];
  warnings: string[];
  customerUrl: string | null;
};

/** The latest paid invoice, from the Payments list (read from Stripe on the page). */
export type LastPayment = { amountCents: number; at: Date } | null;

const intervalWord = (interval: string | null) =>
  interval === "month" ? "monthly" : interval === "year" ? "yearly" : (interval ?? "");

/**
 * The Billing card on the org page (Phase 16 §4.6), or `null` when Stripe has never seen this
 * org. Reads our copy (written by `syncOrgBilling`) plus the latest paid invoice and the total of
 * every paid invoice (`staffTotalPaid`; `null` when Stripe couldn't be reached, so the figure is
 * left out rather than shown as $0.00); the Stripe link is for anything more.
 */
export function staffBilling(
  row: BillingCopy,
  lastPaid: LastPayment = null,
  now: Date = new Date(),
  totalPaidCents: number | null = null,
): StaffBilling | null {
  if (!row.stripeCustomerId && !row.stripeStatus) return null;

  const facts: StaffBilling["facts"] = [];
  const warnings: string[] = [];
  const day = (at: Date) => formatDateShort(todayIso(at));
  const paidLine = lastPaid ? UI.staffBillingLastPaid(formatMoney(lastPaid.amountCents), day(lastPaid.at)) : null;
  const periodEnd = row.currentPeriodEnd ? day(row.currentPeriodEnd) : null;

  const headline: StaffBilling["headline"] =
    row.stripeStatus === "past_due" || row.stripeStatus === "unpaid"
      ? { tone: "bad", label: UI.staffBillingHeadFailed, detail: UI.staffBillingPaymentFailed }
      : row.stripeStatus === "trialing"
        ? { tone: "neutral", label: UI.staffBillingHeadNotYet, detail: periodEnd ? UI.staffBillingFirstCharge(periodEnd) : null }
        : row.stripeStatus === "active" && row.cancelAtPeriodEnd
          ? { tone: "warn", label: UI.staffBillingHeadCancelling, detail: periodEnd ? UI.staffBillingAccessEnds(periodEnd) : paidLine }
          : row.stripeStatus === "active"
            ? { tone: "good", label: UI.staffBillingHeadPaid, detail: paidLine }
            : row.stripeStatus === "canceled" || row.stripeStatus === "incomplete_expired"
              ? { tone: "neutral", label: UI.staffBillingHeadCancelled, detail: paidLine }
              : row.stripeStatus === "incomplete"
                ? { tone: "warn", label: UI.staffBillingHeadUnfinished, detail: null }
                : { tone: "neutral", label: row.stripeStatus ?? UI.staffBillingNone, detail: paidLine };

  if (row.billingInterval) {
    facts.push({ label: UI.staffBillingInterval, value: intervalWord(row.billingInterval) });
  }
  if (periodEnd && row.stripeStatus !== "canceled" && row.stripeStatus !== "incomplete_expired") {
    facts.push({
      label:
        row.stripeStatus === "trialing"
          ? UI.staffBillingFirstChargeLabel
          : row.cancelAtPeriodEnd
            ? UI.staffBillingEnds
            : UI.staffBillingRenews,
      value: periodEnd,
    });
  }
  if (lastPaid) {
    facts.push({ label: UI.staffBillingLastPaidLabel, value: `${formatMoney(lastPaid.amountCents)} · ${day(lastPaid.at)}` });
  }
  if (totalPaidCents !== null) {
    facts.push({ label: UI.staffBillingTotalPaidLabel, value: formatMoney(totalPaidCents), caption: UI.staffBillingTotalPaidNote });
  }
  if (row.pendingAt) {
    facts.push({
      label: UI.staffBillingQueued,
      value:
        row.pendingReason === "price_move" || !row.pendingPlan
          ? UI.staffBillingPriceMove(day(row.pendingAt))
          : UI.staffBillingQueuedValue(PLAN_LABELS[row.pendingPlan], intervalWord(row.pendingInterval), day(row.pendingAt)),
    });
  }

  if (row.upgradeExpiresAt && row.upgradeExpiresAt > now) {
    warnings.push(UI.staffBillingUpgradeWaiting(formatDateTimeShort(row.upgradeExpiresAt)));
  }
  if (row.collectionPaused) warnings.push(UI.staffBillingPaused);
  if (row.disputedAt) warnings.push(UI.staffBillingDisputed(day(row.disputedAt)));

  const customerUrl = row.stripeCustomerId
    ? `https://dashboard.stripe.com/${row.livemode ? "" : "test/"}customers/${encodeURIComponent(row.stripeCustomerId)}`
    : null;

  return { headline, facts, warnings, customerUrl };
}

/** A Stripe invoice status in plain words for the Payments card; an unknown one shows as is. */
export function paymentStatusLabel(status: string): string {
  switch (status) {
    case "paid":
      return UI.staffPaymentPaid;
    case "open":
      return UI.staffPaymentOpen;
    case "void":
      return UI.staffPaymentVoid;
    case "uncollectible":
      return UI.staffPaymentUncollectible;
    case "draft":
      return UI.staffPaymentDraft;
    default:
      return status;
  }
}

/**
 * The History sentence for one event, without the leading timestamp or the trailing note
 * (Phase 4 joins `formatDateTimeShort(createdAt)`, this, and the note with `" – "`).
 */
export function describeAccountEvent(event: AccountEvent): string {
  const actor = event.viaStripe
    ? UI.historyActorStripe
    : event.actorEmail
      ? userDisplay(event.actorName, event.actorEmail)
      : "Unknown";

  switch (event.action) {
    case "plan_changed": {
      const planChanged = event.before.plan !== event.after.plan;
      const statusChanged = event.before.status !== event.after.status;
      if (planChanged && statusChanged) {
        return `${actor} ${UI.historyPlanAndStatusChanged(
          PLAN_LABELS[event.before.plan],
          PLAN_LABELS[event.after.plan],
          STATUS_LABELS[event.before.status],
          STATUS_LABELS[event.after.status],
        )}`;
      }
      if (planChanged) {
        return `${actor} ${UI.historyPlanChanged(
          PLAN_LABELS[event.before.plan],
          PLAN_LABELS[event.after.plan],
        )}`;
      }
      if (statusChanged) {
        return `${actor} ${UI.historyStatusChanged(
          STATUS_LABELS[event.before.status],
          STATUS_LABELS[event.after.status],
        )}`;
      }
      // No-op guard in changePlanAction never writes this, but a fallback beats a dangling sentence.
      return `${actor} ${UI.historyPlanUnchanged}`;
    }
    case "complimentary_granted":
      return event.after.complimentaryUntil === null
        ? `${actor} ${UI.historyComplimentaryGranted}`
        : `${actor} ${UI.historyComplimentaryGrantedUntil(formatDateShort(event.after.complimentaryUntil))}`;
    case "complimentary_changed":
      return event.after.complimentaryUntil === null
        ? `${actor} ${UI.historyComplimentaryChangedNoEnd}`
        : `${actor} ${UI.historyComplimentaryChangedUntil(formatDateShort(event.after.complimentaryUntil))}`;
    case "complimentary_removed":
      return `${actor} ${UI.historyComplimentaryRemoved}`;
    case "suspended":
      return `${actor} ${UI.historySuspended}`;
    case "reinstated":
      return `${actor} ${UI.historyReinstated}`;
    default: {
      const exhaustive: never = event.action;
      throw new Error(`Unknown org account event action: ${exhaustive}`);
    }
  }
}
