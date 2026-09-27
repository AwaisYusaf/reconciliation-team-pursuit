import Form from "next/form";
import Link from "next/link";

import { VoteButton } from "@/src/components/feature-requests/vote-button";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/field";
import { SegmentedLinks } from "@/src/components/ui/segmented-links";
import { Card, EmptyState, PageHeader, Subtext } from "@/src/components/ui/surfaces";
import { formatDateUS, todayIso } from "@/src/domain/dates";
import {
  FEATURE_REQUEST_LIST_LIMIT,
  FEATURE_REQUEST_SEARCH_MAX,
  listHref,
  listQuery,
  parseListParams,
  votingOpen,
  type FeatureRequestListParams,
  type FeatureRequestTab,
} from "@/src/domain/feature-requests";
import { FEATURE_REQUEST_STATUS_LABELS, pageTitle, UI } from "@/src/domain/strings";
import { pageSession } from "@/src/lib/page-session";
import {
  loadFeatureRequestList,
  type FeatureRequestListRow,
} from "@/src/modules/feature-requests/queries";

import { SuggestFeature } from "./suggest-feature-dialog";

export const metadata = { title: pageTitle(UI.featureRequestsTitle) };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Feature requests (PHASE-17, ticket §2): what this organization and everyone else have asked
 * for, with the two tabs and the search in the URL so Back and a reload keep them.
 *
 * Rendered on the server, rows included: another organization's row arrives here with nothing
 * but its title, details, status and votes (`loadFeatureRequestList`), and only the vote button
 * and the dialog are client components.
 */
export default async function FeatureRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await pageSession();
  const params = parseListParams(await searchParams);
  const { rows, capped } = await loadFeatureRequestList(session, params);
  // Carried onto each request's link so its back link returns to this tab and search.
  const back = listQuery(params);

  return (
    <div>
      <PageHeader
        title={UI.featureRequestsTitle}
        subtext={UI.featureRequestsIntro}
        actions={<SuggestFeature />}
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs params={params} />
          <Search params={params} />
        </div>

        {rows.length === 0 ? (
          <EmptyState>{emptyMessage(params)}</EmptyState>
        ) : (
          <Card>
            <ul className="list-none m-0 p-0 divide-y divide-line">
              {rows.map((row) => (
                <RequestRow key={row.id} row={row} back={back} />
              ))}
            </ul>
          </Card>
        )}

        {capped && <Subtext className="text-[15px]">{UI.featureRequestsCapped(FEATURE_REQUEST_LIST_LIMIT)}</Subtext>}
      </div>
    </div>
  );
}

function emptyMessage({ tab, q }: FeatureRequestListParams): string {
  if (q) return UI.featureRequestsNoMatch;
  return tab === "org" ? UI.featureRequestsEmptyOrg : UI.featureRequestsEmptyAll;
}

/** "All requests" / "From your organization": links, so the tab lives in the URL and keeps the
 *  search. */
function Tabs({ params }: { params: FeatureRequestListParams }) {
  const tabs: Array<{ tab: FeatureRequestTab; label: string }> = [
    { tab: "all", label: UI.featureRequestTabAll },
    { tab: "org", label: UI.featureRequestTabOrg },
  ];
  return (
    <SegmentedLinks
      label={UI.featureRequestsTitle}
      items={tabs.map(({ tab, label }) => ({
        href: listHref({ ...params, tab }),
        label,
        active: params.tab === tab,
      }))}
    />
  );
}

/**
 * The search box: a plain GET form (`next/form` navigates client-side), so the words land in
 * the URL and the database does the matching (PHASE-17 P6). No typing delay to explain: it runs
 * when Enter or Search is pressed.
 */
function Search({ params }: { params: FeatureRequestListParams }) {
  return (
    <Form action="/r/feature-requests" role="search" className="flex flex-wrap items-center gap-2 lg:max-w-[460px] w-full">
      {params.tab === "org" && <input type="hidden" name="tab" value="org" />}
      <label htmlFor="feature-request-search" className="sr-only">
        {UI.featureRequestSearchLabel}
      </label>
      <Input
        // Re-mounted when the search changes, so Back shows the words that search used.
        key={params.q}
        id="feature-request-search"
        type="search"
        name="q"
        defaultValue={params.q}
        maxLength={FEATURE_REQUEST_SEARCH_MAX}
        placeholder={UI.featureRequestSearchLabel}
        className="flex-1 min-w-0 w-auto"
      />
      <Button type="submit" variant="secondary" className="min-h-11 px-4 text-[15px]">
        {UI.featureRequestSearchButton}
      </Button>
      {params.q && (
        <Link
          href={listHref({ ...params, q: "" })}
          className="text-[15px] text-accent underline hover:text-accent-dark min-h-11 inline-flex items-center"
        >
          {UI.featureRequestSearchClear}
        </Link>
      )}
    </Form>
  );
}

function RequestRow({ row, back }: { row: FeatureRequestListRow; back: string }) {
  const note = row.isOwn && !row.shownToAll
    ? row.status === "waiting_for_review"
      ? UI.featureRequestWaitingNote
      : UI.featureRequestPrivateNote
    : null;

  return (
    <li className="px-4 py-4 sm:px-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Link
            href={`/r/feature-requests/${row.id}${back ? `?back=${encodeURIComponent(back)}` : ""}`}
            className="text-base font-bold text-ink underline decoration-line underline-offset-4 hover:text-accent hover:decoration-accent [overflow-wrap:anywhere]"
          >
            {row.title}
          </Link>
          {row.isOwn && <Badge tone="neutral">{UI.featureRequestYourOrg}</Badge>}
          {row.teamReplied && <Badge tone="success">{UI.featureRequestTeamReplied}</Badge>}
        </div>
        <p className="mt-1.5 m-0 text-[15px] text-sub leading-relaxed line-clamp-2 whitespace-pre-line [overflow-wrap:anywhere]">
          {row.details}
        </p>
        <p className="mt-2 m-0 text-sm text-sub">
          {[
            FEATURE_REQUEST_STATUS_LABELS[row.status],
            UI.featureRequestVotes(row.votes),
            UI.featureRequestSuggestedOn(formatDateUS(todayIso(row.createdAt))),
          ].join(" · ")}
        </p>
        {note && <p className="mt-1 m-0 text-sm text-sub italic">{note}</p>}
      </div>
      {votingOpen(row.status) && <VoteButton requestId={row.id} voted={row.voted} className="sm:flex-none" />}
    </li>
  );
}
