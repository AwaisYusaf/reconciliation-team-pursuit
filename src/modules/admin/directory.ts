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

export type OrgFilter = {
  search?: string;
  plan?: OrgPlan | null;
  status?: SubscriptionStatus | null;
  badge?: "complimentary" | "suspended" | null;
};

/**
 * Narrows a directory to the rows matching every supplied criterion (Phase 9 §3.9, §6). All
 * criteria AND together; an unset criterion matches everything. Input order is preserved.
 */
export function filterOrgs<T extends DirectoryOrg>(
  rows: readonly T[],
  filter: OrgFilter,
  today: IsoDate,
): T[] {
  const search = filter.search?.trim().toLocaleLowerCase() ?? "";
  return rows.filter((row) => {
    if (search && !row.name.toLocaleLowerCase().includes(search)) return false;
    if (filter.plan && row.plan !== filter.plan) return false;
    if (filter.status && row.subscriptionStatus !== filter.status) return false;
    if (filter.badge === "complimentary" && complimentaryState(row, today) === "none") return false;
    if (filter.badge === "suspended" && row.suspendedAt === null) return false;
    return true;
  });
}

export type DirectorySummary = {
  plan: Record<OrgPlan, number>;
  status: Record<SubscriptionStatus, number>;
  complimentary: number;
  suspended: number;
};

/**
 * The summary cards' counts, always over every row passed in — never a filtered subset (Phase 9
 * §7 Q10). Defined in terms of {@link filterOrgs} itself, so "every card's count equals
 * `filterOrgs(rows, thatCard'sFilter).length`" holds by construction rather than by two pieces
 * of counting logic staying in sync by hand.
 */
export function summarize<T extends DirectoryOrg>(rows: readonly T[], today: IsoDate): DirectorySummary {
  const plans = Object.keys(PLAN_LABELS) as OrgPlan[];
  const statuses = Object.keys(STATUS_LABELS) as SubscriptionStatus[];
  return {
    plan: Object.fromEntries(
      plans.map((plan) => [plan, filterOrgs(rows, { plan }, today).length]),
    ) as Record<OrgPlan, number>,
    status: Object.fromEntries(
      statuses.map((status) => [status, filterOrgs(rows, { status }, today).length]),
    ) as Record<SubscriptionStatus, number>,
    complimentary: filterOrgs(rows, { badge: "complimentary" }, today).length,
    suspended: filterOrgs(rows, { badge: "suspended" }, today).length,
  };
}

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
