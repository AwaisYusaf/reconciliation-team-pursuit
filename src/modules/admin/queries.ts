import "server-only";

/**
 * Everything the `/a` staff dashboard reads (Phase 9 §5, Phase 3). Every query is org-scoped
 * and takes no session — the caller is already behind `requireStaffPage()`.
 */
import { and, count, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";

import { db, type Database } from "@/src/db";
import {
  aiUsageEvents,
  expenses,
  fundingSources,
  generatedArtifacts,
  monthStatuses,
  orgAccountEvents,
  organizations,
  staffUsers,
  users,
  type OrgAccountEventAction,
  type OrgAccountSnapshot,
  type OrgPlan,
  type SubscriptionStatus,
  type UserRole,
} from "@/src/db/schema";
import { currentMonthKey, type MonthKey } from "@/src/domain/dates";
import { isUuid } from "@/src/lib/ids";
import { MAX_ORG_BYTES, orgStorageBytes } from "@/src/services/storage/documents";

/** The org-account fields shown on both the directory and the org page. */
type OrgAccountFields = {
  id: string;
  name: string;
  docName: string;
  createdAt: Date;
  onboardedAt: Date | null;
  plan: OrgPlan;
  subscriptionStatus: SubscriptionStatus;
  complimentary: boolean;
  complimentaryUntil: string | null;
  suspendedAt: Date | null;
};

export type OrgDirectoryRow = OrgAccountFields & {
  userCount: number;
  lastSignInAt: Date | null;
};

/** The org page also shows our copy of Stripe's billing state (Phase 16 §4.6). */
export type OrgAccountRow = OrgAccountFields & {
  stripeCustomerId: string | null;
  stripeLivemode: boolean | null;
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
  billingFlag: string | null;
};

const ORG_ACCOUNT_COLUMNS = {
  id: organizations.id,
  name: organizations.name,
  docName: organizations.docName,
  createdAt: organizations.createdAt,
  onboardedAt: organizations.onboardedAt,
  plan: organizations.plan,
  subscriptionStatus: organizations.subscriptionStatus,
  complimentary: organizations.complimentary,
  complimentaryUntil: organizations.complimentaryUntil,
  suspendedAt: organizations.suspendedAt,
};

/** Re-exported under the names the screens use, so a page never imports from `db/schema`. */
export type OrgPlanFilter = OrgPlan;
export type OrgStatusFilter = SubscriptionStatus;

export type OrgDirectoryFilter = {
  search?: string;
  plan?: OrgPlanFilter | null;
  status?: OrgStatusFilter | null;
  badge?: "complimentary" | "suspended" | null;
};

export type OrgDirectoryPage = {
  rows: OrgDirectoryRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
};

/** Rows per page on the directory. A pagination bar appears only past this. */
export const ORG_PAGE_SIZE = 10;

/**
 * Turns a filter into SQL. Searching, filtering and paging all happen in the database, not in
 * the browser: the first version loaded every organization and narrowed the array on the
 * client, so a search matched only whatever had already been fetched — with 200 organizations
 * on the app, searching for one of them found nothing unless it happened to be on screen.
 *
 * `ilike` with the pattern's own wildcards escaped, so a name containing `%` or `_` searches
 * for those characters rather than matching everything.
 */
function directoryWhere(filter: OrgDirectoryFilter) {
  const clauses = [];

  const search = filter.search?.trim();
  if (search) {
    const escaped = search.replace(/[\\%_]/g, (char) => `\\${char}`);
    clauses.push(sql`${organizations.name} ilike ${`%${escaped}%`}`);
  }
  if (filter.plan) clauses.push(eq(organizations.plan, filter.plan));
  if (filter.status) clauses.push(eq(organizations.subscriptionStatus, filter.status));
  // The complimentary badge counts every organization with it on, ended or not (§7 Q5) — the
  // end date only changes how the badge reads.
  if (filter.badge === "complimentary") clauses.push(eq(organizations.complimentary, true));
  if (filter.badge === "suspended") clauses.push(isNotNull(organizations.suspendedAt));

  return clauses.length > 0 ? and(...clauses) : undefined;
}

/**
 * One page of organizations, newest signup first (Phase 9 §3, §6), with the total the filter
 * matches so the caller can render a pagination bar.
 *
 * A page past the end clamps to the last one rather than rendering an empty table — the usual
 * way to land there is deleting or filtering after a link was made.
 */
export async function loadOrgDirectory(
  filter: OrgDirectoryFilter = {},
  page = 1,
  pageSize = ORG_PAGE_SIZE,
): Promise<OrgDirectoryPage> {
  const where = directoryWhere(filter);

  const [totalRow] = await db
    .select({ total: count() })
    .from(organizations)
    .where(where);
  const total = totalRow?.total ?? 0;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);

  const rows = await db
    .select({
      ...ORG_ACCOUNT_COLUMNS,
      // Drizzle's own `count`/`max` rather than a raw `sql<T>` fragment: the generic on a raw
      // fragment is a compile-time annotation only, so `max(last_sign_in_at)` came back as the
      // driver's raw `"2026-02-01 00:00:00+00"` string while claiming to be a `Date`, and the
      // first `formatDateTimeShort` call on it would have thrown. These helpers carry the
      // column's runtime mapper, so the value really is a `Date` (and the count really a number).
      userCount: count(users.id),
      lastSignInAt: max(users.lastSignInAt),
    })
    .from(organizations)
    .leftJoin(users, eq(users.orgId, organizations.id))
    .where(where)
    .groupBy(organizations.id)
    // `id` breaks ties so paging is stable: two organizations created in the same millisecond
    // could otherwise swap places between page 1 and page 2 and one of them never appear.
    .orderBy(desc(organizations.createdAt), organizations.id)
    .limit(pageSize)
    .offset((current - 1) * pageSize);

  return { rows, total, page: current, pageCount, pageSize };
}

export type OrgDirectorySummary = {
  plan: Record<OrgPlan, number>;
  status: Record<SubscriptionStatus, number>;
  complimentary: number;
  suspended: number;
};

/**
 * The summary cards' counts, over **every** organization rather than the current page or
 * filter (§7 Q10) — they are the filters, so narrowing them by themselves would be circular.
 * One aggregate query rather than counting rows in the browser.
 */
export async function loadOrgSummary(
  // Takes a reader for the same reason `loadPacketReadiness` does: a test can then read this
  // and the rows it is checking against inside one transaction snapshot, which is the only way
  // to assert a global count while other work is committing to the same table.
  reader: Pick<Database, "select"> = db,
): Promise<OrgDirectorySummary> {
  const [row] = await reader
    .select({
      reconciliation: sql<string>`count(*) filter (where ${organizations.plan} = 'reconciliation')`,
      reconciliationAi: sql<string>`count(*) filter (where ${organizations.plan} = 'reconciliation_ai')`,
      trial: sql<string>`count(*) filter (where ${organizations.subscriptionStatus} = 'trial')`,
      active: sql<string>`count(*) filter (where ${organizations.subscriptionStatus} = 'active')`,
      pastDue: sql<string>`count(*) filter (where ${organizations.subscriptionStatus} = 'past_due')`,
      cancelled: sql<string>`count(*) filter (where ${organizations.subscriptionStatus} = 'cancelled')`,
      complimentary: sql<string>`count(*) filter (where ${organizations.complimentary})`,
      suspended: sql<string>`count(*) filter (where ${organizations.suspendedAt} is not null)`,
    })
    .from(organizations);

  return {
    plan: {
      reconciliation: Number(row?.reconciliation ?? 0),
      reconciliation_ai: Number(row?.reconciliationAi ?? 0),
    },
    status: {
      trial: Number(row?.trial ?? 0),
      active: Number(row?.active ?? 0),
      past_due: Number(row?.pastDue ?? 0),
      cancelled: Number(row?.cancelled ?? 0),
    },
    complimentary: Number(row?.complimentary ?? 0),
    suspended: Number(row?.suspended ?? 0),
  };
}

/**
 * One organization's account fields, or `null` when it doesn't exist.
 *
 * `orgId` arrives from the `/a/orgs/[id]` URL, so a malformed value is shape-checked before it
 * reaches a `uuid` column (`src/lib/ids.ts`) — Postgres raises 22P02 on one, which would turn a
 * crafted URL into a 500 instead of the `notFound()` the page wants. Same guard on the three
 * loaders below, for the same reason.
 */
export async function loadOrgAccount(orgId: string): Promise<OrgAccountRow | null> {
  if (!isUuid(orgId)) return null;

  const [row] = await db
    .select({
      ...ORG_ACCOUNT_COLUMNS,
      stripeCustomerId: organizations.stripeCustomerId,
      stripeLivemode: organizations.stripeLivemode,
      stripeStatus: organizations.stripeStatus,
      billingInterval: organizations.billingInterval,
      currentPeriodEnd: organizations.currentPeriodEnd,
      cancelAtPeriodEnd: organizations.cancelAtPeriodEnd,
      pendingPlan: organizations.pendingPlan,
      pendingInterval: organizations.pendingInterval,
      pendingAt: organizations.pendingAt,
      pendingReason: organizations.pendingReason,
      upgradeExpiresAt: organizations.upgradeExpiresAt,
      collectionPaused: organizations.collectionPaused,
      billingFlag: organizations.billingFlag,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return row ?? null;
}

export type OrgUserRow = {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  lastSignInAt: Date | null;
};

/** How many of an organization's users the page shows before "View all". */
export const ORG_USERS_PREVIEW = 10;

/**
 * The ceiling "View all" raises the list to. Not unbounded: re-introducing an uncapped fetch
 * behind a link is the same bug as rendering every user by default, one click further away.
 */
export const ORG_USERS_MAX = 200;

export type OrgUsersPage = { rows: OrgUserRow[]; total: number };

/**
 * One organization's users, oldest first — the first {@link ORG_USERS_PREVIEW} unless `all`.
 *
 * An organization can have any number of users, and the page has no business rendering all of
 * them by default: the limit is applied in SQL, so the rows are never fetched in the first
 * place, and `total` is what the "View all" line counts.
 */
export async function loadOrgUsers(orgId: string, all = false): Promise<OrgUsersPage> {
  if (!isUuid(orgId)) return { rows: [], total: 0 };

  const [totalRow] = await db
    .select({ total: count() })
    .from(users)
    .where(eq(users.orgId, orgId));

  const query = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      lastSignInAt: users.lastSignInAt,
    })
    .from(users)
    .where(eq(users.orgId, orgId))
    .orderBy(users.createdAt, users.id);

  const rows = await query.limit(all ? ORG_USERS_MAX : ORG_USERS_PREVIEW);
  return { rows, total: totalRow?.total ?? 0 };
}

export type OrgUsage = {
  fundingSourcesActive: number;
  fundingSourcesArchived: number;
  expensesTotal: number;
  expensesCurrentMonth: number;
  currentMonth: MonthKey;
  lastExpenseAt: Date | null;
  storageBytes: number;
  storageLimitBytes: number;
  monthsSubmitted: number;
  monthsLocked: number;
  packetsDownloaded: number;
};

function emptyUsage(currentMonth: MonthKey): OrgUsage {
  return {
    fundingSourcesActive: 0,
    fundingSourcesArchived: 0,
    expensesTotal: 0,
    expensesCurrentMonth: 0,
    currentMonth,
    lastExpenseAt: null,
    storageBytes: 0,
    storageLimitBytes: MAX_ORG_BYTES,
    monthsSubmitted: 0,
    monthsLocked: 0,
    packetsDownloaded: 0,
  };
}

/** One organization's usage counts for the Usage card (Phase 9 §6). */
export async function loadOrgUsage(orgId: string): Promise<OrgUsage> {
  const currentMonth = currentMonthKey();
  // Same 22P02 guard as `loadOrgAccount`: an org that cannot exist has used nothing.
  if (!isUuid(orgId)) return emptyUsage(currentMonth);

  const [
    fundingSourceCounts,
    expenseCounts,
    lastExpense,
    storageBytes,
    monthStatusCounts,
    packetsDownloadedRow,
  ] = await Promise.all([
    db
      .select({
        active: sql<string>`count(*) filter (where ${fundingSources.archivedAt} is null)`,
        archived: sql<string>`count(*) filter (where ${fundingSources.archivedAt} is not null)`,
      })
      .from(fundingSources)
      .where(eq(fundingSources.orgId, orgId)),
    db
      .select({
        total: sql<string>`count(*)`,
        currentMonth: sql<string>`count(*) filter (where ${expenses.month} = ${currentMonth})`,
      })
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), isNull(expenses.deletedAt))),
    db
      // `max` rather than a raw `sql<Date | null>` fragment — see `loadOrgDirectory` above.
      .select({ lastExpenseAt: max(expenses.createdAt) })
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), isNull(expenses.deletedAt))),
    orgStorageBytes(db, orgId),
    db
      .select({
        submitted: sql<string>`count(*) filter (where ${monthStatuses.submittedAt} is not null)`,
        locked: sql<string>`count(*) filter (where ${monthStatuses.lockedAt} is not null)`,
      })
      .from(monthStatuses)
      .where(eq(monthStatuses.orgId, orgId)),
    db
      .select({ count: sql<string>`count(*)` })
      .from(generatedArtifacts)
      .where(
        and(
          eq(generatedArtifacts.orgId, orgId),
          eq(generatedArtifacts.type, "packet_pdf"),
          isNotNull(generatedArtifacts.downloadedAt),
        ),
      ),
  ]);

  return {
    fundingSourcesActive: Number(fundingSourceCounts[0]?.active ?? 0),
    fundingSourcesArchived: Number(fundingSourceCounts[0]?.archived ?? 0),
    expensesTotal: Number(expenseCounts[0]?.total ?? 0),
    expensesCurrentMonth: Number(expenseCounts[0]?.currentMonth ?? 0),
    currentMonth,
    lastExpenseAt: lastExpense[0]?.lastExpenseAt ?? null,
    storageBytes: storageBytes ?? 0,
    storageLimitBytes: MAX_ORG_BYTES,
    monthsSubmitted: Number(monthStatusCounts[0]?.submitted ?? 0),
    monthsLocked: Number(monthStatusCounts[0]?.locked ?? 0),
    packetsDownloaded: Number(packetsDownloadedRow[0]?.count ?? 0),
  };
}

export type OrgAccountEventRow = {
  id: string;
  createdAt: Date;
  action: OrgAccountEventAction;
  before: OrgAccountSnapshot;
  after: OrgAccountSnapshot;
  note: string | null;
  actorName: string | null;
  actorEmail: string | null;
  viaStripe: boolean;
};

/**
 * How many history lines the organization page shows. Staff actions are the only thing that
 * writes one, so an organization accrues a handful a year — but this is the last unbounded
 * read on the page, and the cap costs a line.
 */
export const ORG_HISTORY_LIMIT = 50;

/** One organization's account-change history, newest first, capped at {@link ORG_HISTORY_LIMIT}. */
export async function loadOrgHistory(orgId: string): Promise<OrgAccountEventRow[]> {
  if (!isUuid(orgId)) return [];

  return db
    .select({
      id: orgAccountEvents.id,
      createdAt: orgAccountEvents.createdAt,
      action: orgAccountEvents.action,
      before: orgAccountEvents.before,
      after: orgAccountEvents.after,
      note: orgAccountEvents.note,
      actorName: staffUsers.name,
      actorEmail: staffUsers.email,
      viaStripe: orgAccountEvents.viaStripe,
    })
    .from(orgAccountEvents)
    .leftJoin(staffUsers, eq(staffUsers.id, orgAccountEvents.actorStaffId))
    .where(eq(orgAccountEvents.orgId, orgId))
    .orderBy(desc(orgAccountEvents.createdAt), desc(orgAccountEvents.id))
    .limit(ORG_HISTORY_LIMIT);
}

/* ------------------------------------------------------------------ AI usage */

/** One organization's AI usage, for the AI usage card (Phase 11, D-107). Costs are micro-USD —
 *  a thousandth of a cent — because a single amount read costs a fraction of a cent. */
export type OrgAiUsage = {
  currentMonth: MonthKey;
  /** Invoice reads (Phase 14): one per invoice the app read into charges. Counted apart from
   *  `reads` because one costs far more — a whole multi-page bill rather than one receipt. */
  invoiceReads: { total: number; currentMonth: number; unsaved: number };
  /** Amount reads (Phase 10) and monthly summaries (Phase 11), counted separately: they cost
   *  two orders of magnitude apart, so one combined number would say nothing useful. */
  reads: { total: number; currentMonth: number; unsaved: number };
  summaries: { total: number; currentMonth: number; unsaved: number };
  costMicroUsdTotal: number;
  costMicroUsdCurrentMonth: number;
  /** True when any run is missing its cost, which happens when the price settings were unset on
   *  the server at the time — the totals below are then a floor, not the whole bill. */
  costIncomplete: boolean;
  lastRunAt: Date | null;
};

function emptyAiUsage(currentMonth: MonthKey): OrgAiUsage {
  return {
    currentMonth,
    reads: { total: 0, currentMonth: 0, unsaved: 0 },
    summaries: { total: 0, currentMonth: 0, unsaved: 0 },
    invoiceReads: { total: 0, currentMonth: 0, unsaved: 0 },
    costMicroUsdTotal: 0,
    costMicroUsdCurrentMonth: 0,
    costIncomplete: false,
    lastRunAt: null,
  };
}

export async function loadOrgAiUsage(orgId: string): Promise<OrgAiUsage> {
  const currentMonth = currentMonthKey();
  // Same 22P02 guard as `loadOrgUsage`: an org id that cannot exist has used nothing.
  if (!isUuid(orgId)) return emptyAiUsage(currentMonth);

  // One row per feature, so the card needs a single round trip. `created_at` is a timestamp, not
  // the expense month, so "this month" here means when the run happened — which is what a bill is
  // drawn against. The month is the organisation's own (America/Detroit, R2.5), matching the
  // label the card prints: comparing against UTC counted a run made on the 1st before 5am — or
  // the last evening of a month — in the wrong month, and `now() at time zone 'utc'` would also
  // have re-cast against whatever the server's session timezone happened to be.
  const thisMonth = sql`to_char(${aiUsageEvents.createdAt} at time zone 'America/Detroit', 'YYYY-MM') = ${currentMonth}`;
  const rows = await db
    .select({
      feature: aiUsageEvents.feature,
      total: sql<string>`count(*)`,
      currentMonth: sql<string>`count(*) filter (where ${thisMonth})`,
      // Nothing was saved for either, but a rejected run always spent tokens, and a failed one
      // may have (a retry that failed in transport still paid for the first attempt).
      unsaved: sql<string>`count(*) filter (where ${aiUsageEvents.outcome} in ('failed', 'rejected'))`,
      cost: sql<string>`coalesce(sum(${aiUsageEvents.costMicroUsd}), 0)`,
      costThisMonth: sql<string>`coalesce(sum(${aiUsageEvents.costMicroUsd}) filter (where ${thisMonth}), 0)`,
      // Only a run that produced tokens but no cost means the price settings were unset. A failed
      // run has no token counts at all, so counting it here claimed a missing price that was never
      // missing.
      missingCost: sql<string>`count(*) filter (where ${aiUsageEvents.costMicroUsd} is null and ${aiUsageEvents.inputTokens} is not null)`,
      lastRunAt: max(aiUsageEvents.createdAt),
    })
    .from(aiUsageEvents)
    .where(eq(aiUsageEvents.orgId, orgId))
    .groupBy(aiUsageEvents.feature);

  const usage = emptyAiUsage(currentMonth);
  for (const row of rows) {
    const counts = {
      total: Number(row.total),
      currentMonth: Number(row.currentMonth),
      unsaved: Number(row.unsaved),
    };
    // Explicit on every side: a feature added later must show up as its own tile rather than
    // being silently added to another column. `invoice_read` (Phase 14) was the case this
    // warning was written for and it still landed in no tile, so its runs were invisible on
    // this page while its cost was still added to the totals below — the counts and the money
    // did not reconcile, which is exactly what a billing page must never do.
    if (row.feature === "amount_read") usage.reads = counts;
    else if (row.feature === "monthly_summary") usage.summaries = counts;
    else if (row.feature === "invoice_read") usage.invoiceReads = counts;
    usage.costMicroUsdTotal += Number(row.cost);
    usage.costMicroUsdCurrentMonth += Number(row.costThisMonth);
    if (Number(row.missingCost) > 0) usage.costIncomplete = true;
    if (row.lastRunAt && (!usage.lastRunAt || row.lastRunAt > usage.lastRunAt)) {
      usage.lastRunAt = row.lastRunAt;
    }
  }
  return usage;
}
