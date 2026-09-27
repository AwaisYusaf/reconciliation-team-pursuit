/**
 * Feature request rules that need no database (PHASE-17): the limits, which statuses allow what,
 * and reading and building the two list URLs. Pure, so the pages, the actions and the `/a` filter
 * component share one copy (the review rule: one helper parses and builds a page's URL).
 */
import type { FeatureRequestStatus } from "@/src/db/schema";
import { FEATURE_REQUEST_STATUS_LABELS } from "@/src/domain/strings";

/** Ticket §3 and §4. Shared with the boxes' `maxLength`, so the two can't drift apart. */
export const FEATURE_REQUEST_TITLE_MAX = 100;
export const FEATURE_REQUEST_DETAILS_MAX = 2000;
export const FEATURE_REQUEST_REPLY_MAX = 2000;

/** Ticket §3: one person, one America/Detroit day. */
export const FEATURE_REQUESTS_PER_DAY = 10;

/**
 * Rows on the customer list (PHASE-17 P7). No pages there: pages over a list sorted by votes
 * shuffle rows between them. Past this the list says so and points to the search box.
 */
export const FEATURE_REQUEST_LIST_LIMIT = 100;

/** Ticket §6: ten per page, like the organizations list. */
export const STAFF_FEATURE_REQUEST_PAGE_SIZE = 10;

/** An organization's card in `/a`, capped like its History (`ORG_HISTORY_LIMIT`). */
export const ORG_FEATURE_REQUESTS_LIMIT = 50;

/** Longest search text read from a URL; the rest is dropped. */
export const FEATURE_REQUEST_SEARCH_MAX = 100;

/** Ticket §5: these two are never shown to other organizations. The database CHECK
 *  `feature_requests_shown_status_ck` holds the same rule, so this is only the friendly refusal. */
export function canShowToAll(status: FeatureRequestStatus): boolean {
  return status !== "waiting_for_review" && status !== "already_requested";
}

/** Ticket §2 and PHASE-17 Q3: finished, turned down or a duplicate takes no more votes. */
export function votingOpen(status: FeatureRequestStatus): boolean {
  return status !== "released" && status !== "not_planned" && status !== "already_requested";
}

/**
 * A `?status=` value, or null for anything else. `Object.hasOwn`, never `in`: `in` walks the
 * prototype, so `?status=constructor` would reach Postgres as an enum value and 500 (PR #17).
 */
export function parseFeatureRequestStatus(value: string | undefined): FeatureRequestStatus | null {
  return value && Object.hasOwn(FEATURE_REQUEST_STATUS_LABELS, value)
    ? (value as FeatureRequestStatus)
    : null;
}

/** A title is one line: runs of whitespace, newlines included, become one space. */
export function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** The words a search matches, every one of which must appear (PHASE-17 P6). */
export function searchWords(q: string): string[] {
  return q.split(/\s+/).filter(Boolean);
}

/** `%`, `_` and `\` escaped, so they search for themselves in an `ilike` pattern. */
export function likePattern(word: string): string {
  return `%${word.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

type SearchParams = Record<string, string | string[] | undefined>;

/** The first value of a repeated query parameter. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseSearch(value: string | string[] | undefined): string {
  return (one(value) ?? "").trim().slice(0, FEATURE_REQUEST_SEARCH_MAX).trim();
}

export type FeatureRequestTab = "all" | "org";

export type FeatureRequestListParams = { tab: FeatureRequestTab; q: string };

/** `/r/feature-requests`: only `tab=org` means the org tab; anything else is All. */
export function parseListParams(params: SearchParams): FeatureRequestListParams {
  return { tab: one(params.tab) === "org" ? "org" : "all", q: parseSearch(params.q) };
}

export function listHref({ tab, q }: FeatureRequestListParams): string {
  const query = new URLSearchParams();
  if (tab === "org") query.set("tab", "org");
  if (q) query.set("q", q);
  const text = query.toString();
  return text ? `/r/feature-requests?${text}` : "/r/feature-requests";
}

/**
 * The list a detail page's back link returns to. Only a query string is honoured, as on
 * `/a/orgs/[id]`: a `?back=https://…` must never become a link off the app.
 */
export function backHref(base: string, back: string | string[] | undefined): string {
  const raw = one(back);
  return raw && raw.startsWith("?") ? `${base}${raw}` : base;
}

export type StaffFeatureRequestFilter = {
  q: string;
  status: FeatureRequestStatus | null;
  attention: boolean;
};

/** `/a/feature-requests`: the filter and the requested page (the loader clamps it). */
export function parseStaffFilter(params: SearchParams): {
  filter: StaffFeatureRequestFilter;
  page: number;
} {
  const page = Number(one(params.page) ?? "1");
  return {
    filter: {
      q: parseSearch(params.q),
      status: parseFeatureRequestStatus(one(params.status)),
      attention: one(params.attention) === "1",
    },
    page: Number.isFinite(page) ? page : 1,
  };
}

export function staffListHref(filter: StaffFeatureRequestFilter, page = 1): string {
  const query = new URLSearchParams();
  if (filter.q) query.set("q", filter.q);
  if (filter.status) query.set("status", filter.status);
  if (filter.attention) query.set("attention", "1");
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `/a/feature-requests?${text}` : "/a/feature-requests";
}
