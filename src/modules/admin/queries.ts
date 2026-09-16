import "server-only";

/**
 * Everything the `/a` staff dashboard reads (Phase 9 §5, Phase 3). Every query is org-scoped
 * and takes no session — the caller is already behind `requireStaffPage()`.
 */
import { and, count, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";

import { db } from "@/src/db";
import {
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

export type OrgAccountRow = OrgAccountFields;

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

/** Every organization, one row each, newest signup first (Phase 9 §3, §6). */
export async function loadOrgDirectory(): Promise<OrgDirectoryRow[]> {
  return db
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
    .groupBy(organizations.id)
    .orderBy(desc(organizations.createdAt), organizations.id);
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
    .select(ORG_ACCOUNT_COLUMNS)
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

/** One organization's users, oldest first. */
export async function loadOrgUsers(orgId: string): Promise<OrgUserRow[]> {
  if (!isUuid(orgId)) return [];

  return db
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
};

/** One organization's account-change history, newest first. */
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
    })
    .from(orgAccountEvents)
    .leftJoin(staffUsers, eq(staffUsers.id, orgAccountEvents.actorStaffId))
    .where(eq(orgAccountEvents.orgId, orgId))
    .orderBy(desc(orgAccountEvents.createdAt), desc(orgAccountEvents.id));
}

