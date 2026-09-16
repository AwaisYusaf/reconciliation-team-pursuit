/**
 * Pure `/a` directory logic (Phase 9 §3.9, §5, Phase 3): the filter/search predicate, the
 * summary counts built from that same predicate, and the History sentence. No `db` import and
 * no `server-only` — this module is also used by a client component (Phase 4).
 */
import type { IsoDate } from "@/src/domain/dates";
import { formatDateShort } from "@/src/domain/dates";
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

export type ComplimentaryState = "none" | "active" | "ended";

/**
 * Whether an org's complimentary access is off, active, or ended (Phase 9 §7 Q6). An end date
 * of today is still active — it ends *after* that day, so only a strictly earlier date counts
 * as ended.
 */
export function complimentaryState(
  org: { complimentary: boolean; complimentaryUntil: IsoDate | null },
  today: IsoDate,
): ComplimentaryState {
  if (!org.complimentary) return "none";
  if (org.complimentaryUntil === null) return "active";
  return org.complimentaryUntil < today ? "ended" : "active";
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
};

/**
 * The History sentence for one event, without the leading timestamp or the trailing note
 * (Phase 4 joins `formatDateTimeShort(createdAt)`, this, and the note with `" – "`).
 */
export function describeAccountEvent(event: AccountEvent): string {
  const actor = event.actorEmail ? userDisplay(event.actorName, event.actorEmail) : "Unknown";

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
