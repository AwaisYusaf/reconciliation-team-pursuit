import "server-only";

/**
 * What the `/a` staff dashboard reads about feature requests (PHASE-17, ticket §6 to §8). Takes
 * no session: every caller is already behind `requireStaffPage()`. Staff see everything,
 * including who asked and the customer's original wording.
 *
 * "Needs attention" and the reply thread come from `queries.ts`, so the customer's "Our team
 * replied" and the staff's attention count are read off the same newest reply.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";

import { db } from "@/src/db";
import type { Reader } from "@/src/db/queries";
import {
  featureRequests,
  featureRequestVotes,
  organizations,
  users,
  type FeatureRequestStatus,
} from "@/src/db/schema";
import {
  ORG_FEATURE_REQUESTS_LIMIT,
  STAFF_FEATURE_REQUEST_PAGE_SIZE,
  type StaffFeatureRequestFilter,
} from "@/src/domain/feature-requests";
import { isUuid } from "@/src/lib/ids";

import {
  loadReplies,
  matchesWords,
  needsAttention,
  voteCount,
  type FeatureRequestReplyView,
} from "./queries";

/** The number beside "Feature requests" at the top of /a. */
export async function countFeatureRequestsNeedingAttention(reader: Reader = db): Promise<number> {
  const [row] = await reader
    .select({ total: count() })
    .from(featureRequests)
    .where(needsAttention);
  return row?.total ?? 0;
}

function staffWhere(filter: StaffFeatureRequestFilter) {
  return and(
    // The organization's name too: staff often know who asked before they know the words.
    ...matchesWords(filter.q, (pattern) => [sql`${organizations.name} ilike ${pattern}`]),
    filter.status ? eq(featureRequests.status, filter.status) : undefined,
    filter.attention ? needsAttention : undefined,
  );
}

export type StaffFeatureRequestRow = {
  id: string;
  title: string;
  status: FeatureRequestStatus;
  createdAt: Date;
  shownToAll: boolean;
  orgId: string;
  orgName: string;
  authorName: string | null;
  authorEmail: string | null;
  votes: number;
  needsAttention: boolean;
};

/**
 * One page of requests, newest first (ticket §6), counted and paged in SQL like the
 * organizations list (D-102). A page past the end clamps to the last one.
 */
export async function loadStaffFeatureRequests(
  filter: StaffFeatureRequestFilter,
  page = 1,
  pageSize = STAFF_FEATURE_REQUEST_PAGE_SIZE,
): Promise<{ rows: StaffFeatureRequestRow[]; total: number; page: number; pageCount: number }> {
  const where = staffWhere(filter);

  const [totalRow] = await db
    .select({ total: count() })
    .from(featureRequests)
    .innerJoin(organizations, eq(organizations.id, featureRequests.orgId))
    .where(where);
  const total = totalRow?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);

  const rows = await db
    .select({
      id: featureRequests.id,
      title: featureRequests.title,
      status: featureRequests.status,
      createdAt: featureRequests.createdAt,
      shownToAll: sql<boolean>`${featureRequests.shownToAllAt} is not null`,
      orgId: organizations.id,
      orgName: organizations.name,
      authorName: users.name,
      authorEmail: users.email,
      votes: voteCount,
      needsAttention,
    })
    .from(featureRequests)
    .innerJoin(organizations, eq(organizations.id, featureRequests.orgId))
    .leftJoin(users, eq(users.id, featureRequests.authorUserId))
    .where(where)
    // `id` breaks ties so paging is stable, as on the organizations list.
    .orderBy(desc(featureRequests.createdAt), featureRequests.id)
    .limit(pageSize)
    .offset((current - 1) * pageSize);

  return {
    rows: rows.map((row) => ({ ...row, votes: Number(row.votes) })),
    total,
    page: current,
    pageCount,
  };
}

export type StaffFeatureRequest = {
  id: string;
  title: string;
  details: string;
  originalTitle: string | null;
  originalDetails: string | null;
  status: FeatureRequestStatus;
  shownToAll: boolean;
  createdAt: Date;
  orgId: string;
  orgName: string;
  authorName: string | null;
  authorEmail: string | null;
  votes: number;
  /** Organizations whose people voted, most votes first (ticket §7, staff only). */
  votesByOrg: Array<{ orgId: string; orgName: string; votes: number }>;
  replies: FeatureRequestReplyView[];
};

/** One request with everything staff see, or null for an unknown or malformed id. */
export async function loadStaffFeatureRequest(id: string): Promise<StaffFeatureRequest | null> {
  if (!isUuid(id)) return null;

  const [row] = await db
    .select({
      id: featureRequests.id,
      title: featureRequests.title,
      details: featureRequests.details,
      originalTitle: featureRequests.originalTitle,
      originalDetails: featureRequests.originalDetails,
      status: featureRequests.status,
      shownToAllAt: featureRequests.shownToAllAt,
      createdAt: featureRequests.createdAt,
      orgId: organizations.id,
      orgName: organizations.name,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(featureRequests)
    .innerJoin(organizations, eq(organizations.id, featureRequests.orgId))
    .leftJoin(users, eq(users.id, featureRequests.authorUserId))
    .where(eq(featureRequests.id, id))
    .limit(1);
  if (!row) return null;

  const [votesByOrg, replies] = await Promise.all([
    db
      .select({ orgId: organizations.id, orgName: organizations.name, votes: count() })
      .from(featureRequestVotes)
      .innerJoin(organizations, eq(organizations.id, featureRequestVotes.orgId))
      .where(eq(featureRequestVotes.requestId, id))
      .groupBy(organizations.id, organizations.name)
      .orderBy(desc(count()), organizations.name),
    loadReplies(id),
  ]);

  const { shownToAllAt, ...rest } = row;
  return {
    ...rest,
    shownToAll: shownToAllAt !== null,
    votes: votesByOrg.reduce((sum, org) => sum + org.votes, 0),
    votesByOrg,
    replies,
  };
}

export type OrgFeatureRequestRow = {
  id: string;
  title: string;
  status: FeatureRequestStatus;
  createdAt: Date;
};

/** One organization's requests for its card on `/a/orgs/[id]` (ticket §8), newest first. */
export async function loadOrgFeatureRequests(
  orgId: string,
): Promise<{ rows: OrgFeatureRequestRow[]; capped: boolean }> {
  if (!isUuid(orgId)) return { rows: [], capped: false };
  const rows = await db
    .select({
      id: featureRequests.id,
      title: featureRequests.title,
      status: featureRequests.status,
      createdAt: featureRequests.createdAt,
    })
    .from(featureRequests)
    .where(eq(featureRequests.orgId, orgId))
    .orderBy(desc(featureRequests.createdAt), desc(featureRequests.id))
    .limit(ORG_FEATURE_REQUESTS_LIMIT + 1);
  return {
    rows: rows.slice(0, ORG_FEATURE_REQUESTS_LIMIT),
    capped: rows.length > ORG_FEATURE_REQUESTS_LIMIT,
  };
}
