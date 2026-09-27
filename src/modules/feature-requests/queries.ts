import "server-only";

/**
 * What customers read about feature requests (PHASE-17, D-127).
 *
 * The one place another organization's rows are ever read from, so the rules live here and
 * nowhere else: `visibleTo` decides what an organization may see, and a request that is not its
 * own is returned as its title, details, status and votes only. No other field of another
 * organization's request is selected, so nothing else can reach a page or the browser.
 *
 * Every loader takes the org and user from the session, never from the client.
 */
import { and, asc, desc, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/src/db";
import type { Reader } from "@/src/db/queries";
import {
  featureRequestReplies,
  featureRequests,
  featureRequestVotes,
  users,
  type FeatureRequestStatus,
} from "@/src/db/schema";
import {
  FEATURE_REQUEST_LIST_LIMIT,
  likePattern,
  searchWords,
  type FeatureRequestListParams,
} from "@/src/domain/feature-requests";
import { userDisplay } from "@/src/domain/user-display";
import { isUuid } from "@/src/lib/ids";

/** Who is asking: both come from the session. */
export type Viewer = { orgId: string; userId: string };

/**
 * The one rule for who sees a request (PHASE-17 P1): its own organization always, everyone else
 * once staff have turned on "Show to all organizations". Waiting for review and Already
 * requested can't be shown at all (`feature_requests_shown_status_ck`), so they need no clause.
 */
export function visibleTo(orgId: string): SQL {
  return or(eq(featureRequests.orgId, orgId), isNotNull(featureRequests.shownToAllAt))!;
}

/**
 * The outer query's request id, spelled out with its table, for the correlated subqueries below.
 * Drizzle renders a column bare in a single-table select, and a bare `id` inside a subquery on
 * votes or replies is that row's own id, which never matches: every count came back 0 until this
 * (the same trap `hasAuditHistory` in `users/actions.ts` records).
 */
const outerRequestId = sql`${featureRequests}.${sql.identifier("id")}`;

/**
 * Whether the newest reply on the request in the outer query is our team's; null with no
 * replies. Replies are append-only, so this is always current and nothing stores it (P2). The
 * id breaks a same-millisecond tie the way uuid v7 was issued.
 */
export const lastReplyFromStaff = sql<boolean | null>`(
  select ${featureRequestReplies.fromStaff} from ${featureRequestReplies}
  where ${featureRequestReplies.requestId} = ${outerRequestId}
  order by ${featureRequestReplies.createdAt} desc, ${featureRequestReplies.id} desc
  limit 1
)`;

/**
 * "Needs attention" in /a (ticket §6, PHASE-17 Q2): the customer wrote last, or nobody has
 * written and it is still waiting for review. So a staff reply clears it, moving off Waiting for
 * review clears it while nobody has replied, and a customer's reply brings it back until our
 * team answers, whatever the status.
 */
export const needsAttention = sql<boolean>`coalesce(not ${lastReplyFromStaff}, ${featureRequests.status} = 'waiting_for_review')`;

/** Everyone's votes on the request in the outer query. */
export const voteCount = sql<string>`(
  select count(*) from ${featureRequestVotes}
  where ${featureRequestVotes.requestId} = ${outerRequestId}
)`;

function votedBy(userId: string) {
  return sql<boolean>`exists (
    select 1 from ${featureRequestVotes}
    where ${featureRequestVotes.requestId} = ${outerRequestId}
      and ${featureRequestVotes.userId} = ${userId}
  )`;
}

/** Every word must appear in the title or the details (P6). Never the original wording: an
 *  edit usually removes a name, and a search for that name would otherwise still find it. */
export function matchesWords(q: string, extra: (pattern: string) => SQL[] = () => []): SQL[] {
  return searchWords(q).map((word) => {
    const pattern = likePattern(word);
    return or(
      sql`${featureRequests.title} ilike ${pattern}`,
      sql`${featureRequests.details} ilike ${pattern}`,
      ...extra(pattern),
    )!;
  });
}

export type FeatureRequestListRow = {
  id: string;
  title: string;
  details: string;
  status: FeatureRequestStatus;
  createdAt: Date;
  votes: number;
  voted: boolean;
  /** Everything below is only ever true on the viewer's own organization's rows. */
  isOwn: boolean;
  /** Always true on another organization's row, which is only visible because it is shown. */
  shownToAll: boolean;
  teamReplied: boolean;
};

/**
 * The customer list: "All requests" (most votes, then newest) or "From your organization"
 * (newest first, PHASE-17 Q1), narrowed by the search. At most `FEATURE_REQUEST_LIST_LIMIT`
 * rows, with `capped` saying there were more.
 */
export async function loadFeatureRequestList(
  viewer: Viewer,
  { tab, q }: FeatureRequestListParams,
): Promise<{ rows: FeatureRequestListRow[]; capped: boolean }> {
  const own = sql`${featureRequests.orgId} = ${viewer.orgId}`;
  const rows = await db
    .select({
      id: featureRequests.id,
      title: featureRequests.title,
      details: featureRequests.details,
      status: featureRequests.status,
      createdAt: featureRequests.createdAt,
      votes: voteCount,
      voted: votedBy(viewer.userId),
      isOwn: sql<boolean>`${own}`,
      shownToAll: sql<boolean>`${featureRequests.shownToAllAt} is not null`,
      // Another organization never learns whether a request has replies (ticket §4).
      teamReplied: sql<boolean>`(${own} and coalesce(${lastReplyFromStaff}, false))`,
    })
    .from(featureRequests)
    .where(
      and(
        visibleTo(viewer.orgId),
        tab === "org" ? eq(featureRequests.orgId, viewer.orgId) : undefined,
        ...matchesWords(q),
      ),
    )
    .orderBy(
      ...(tab === "org"
        ? [desc(featureRequests.createdAt), desc(featureRequests.id)]
        : [sql`${voteCount} desc`, desc(featureRequests.createdAt), desc(featureRequests.id)]),
    )
    .limit(FEATURE_REQUEST_LIST_LIMIT + 1);

  return {
    rows: rows.slice(0, FEATURE_REQUEST_LIST_LIMIT).map((row) => ({ ...row, votes: Number(row.votes) })),
    capped: rows.length > FEATURE_REQUEST_LIST_LIMIT,
  };
}

export type FeatureRequestReplyView = {
  id: string;
  fromStaff: boolean;
  /** The customer's name; null for our team's replies (signed as the team) and for a removed
   *  account. A staff member's own name is never selected. */
  authorName: string | null;
  body: string;
  createdAt: Date;
};

/** A request's conversation, oldest first. Only ever called for a request the reader may see
 *  the replies of: its own organization, or staff. */
export async function loadReplies(requestId: string): Promise<FeatureRequestReplyView[]> {
  const rows = await db
    .select({
      id: featureRequestReplies.id,
      fromStaff: featureRequestReplies.fromStaff,
      name: users.name,
      email: users.email,
      body: featureRequestReplies.body,
      createdAt: featureRequestReplies.createdAt,
    })
    .from(featureRequestReplies)
    .leftJoin(users, eq(users.id, featureRequestReplies.authorUserId))
    .where(eq(featureRequestReplies.requestId, requestId))
    .orderBy(asc(featureRequestReplies.createdAt), asc(featureRequestReplies.id));

  return rows.map(({ name, email, ...reply }) => ({
    ...reply,
    authorName: !reply.fromStaff && email ? userDisplay(name, email) : null,
  }));
}

export type OwnFeatureRequest = {
  kind: "own";
  id: string;
  title: string;
  details: string;
  status: FeatureRequestStatus;
  createdAt: Date;
  votes: number;
  voted: boolean;
  shownToAll: boolean;
  /** Null once the author's account is removed (P13). */
  authorName: string | null;
  replies: FeatureRequestReplyView[];
};

/** Another organization's request: exactly what ticket §4 lets it see, and nothing more. */
export type PublicFeatureRequest = {
  kind: "public";
  id: string;
  title: string;
  details: string;
  status: FeatureRequestStatus;
  votes: number;
  voted: boolean;
};

/**
 * One request for the detail page, or null when it doesn't exist or this organization can't see
 * it. The two are the same answer on purpose (P9): a hidden request's address must look exactly
 * like a missing one.
 */
export async function loadFeatureRequest(
  viewer: Viewer,
  id: string,
): Promise<OwnFeatureRequest | PublicFeatureRequest | null> {
  if (!isUuid(id)) return null;

  const [row] = await db
    .select({
      id: featureRequests.id,
      orgId: featureRequests.orgId,
      title: featureRequests.title,
      details: featureRequests.details,
      status: featureRequests.status,
      votes: voteCount,
      voted: votedBy(viewer.userId),
    })
    .from(featureRequests)
    .where(and(eq(featureRequests.id, id), visibleTo(viewer.orgId)))
    .limit(1);
  if (!row) return null;

  const { orgId, ...common } = row;
  const base = { ...common, votes: Number(common.votes) };
  if (orgId !== viewer.orgId) return { kind: "public", ...base };

  // Its own organization: the rest is read only now, so no path above can hand it to another.
  const [ownRow] = await db
    .select({
      createdAt: featureRequests.createdAt,
      shownToAllAt: featureRequests.shownToAllAt,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(featureRequests)
    .leftJoin(users, eq(users.id, featureRequests.authorUserId))
    .where(and(eq(featureRequests.id, id), eq(featureRequests.orgId, viewer.orgId)))
    .limit(1);
  if (!ownRow) return null;

  return {
    kind: "own",
    ...base,
    createdAt: ownRow.createdAt,
    shownToAll: ownRow.shownToAllAt !== null,
    authorName: ownRow.authorEmail ? userDisplay(ownRow.authorName, ownRow.authorEmail) : null,
    replies: await loadReplies(id),
  };
}

/**
 * The request a vote or reply is about, if this organization can see it (P9). Takes a reader so
 * an action can read it inside its own transaction; `lock` holds the row (`FOR SHARE`) until that
 * transaction ends, so staff hiding or closing it wait for a vote that already passed the check.
 */
export async function findVisibleFeatureRequest(
  reader: Reader,
  orgId: string,
  id: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<{ status: FeatureRequestStatus; isOwn: boolean } | null> {
  if (!isUuid(id)) return null;
  const query = reader
    .select({ status: featureRequests.status, orgId: featureRequests.orgId })
    .from(featureRequests)
    .where(and(eq(featureRequests.id, id), visibleTo(orgId)))
    .limit(1);
  const [row] = lock ? await query.for("share") : await query;
  return row ? { status: row.status, isOwn: row.orgId === orgId } : null;
}
