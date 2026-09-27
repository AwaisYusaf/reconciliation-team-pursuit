import Link from "next/link";
import { notFound } from "next/navigation";

import { ReplyForm } from "@/src/components/feature-requests/reply-form";
import { ReplyThread } from "@/src/components/feature-requests/reply-thread";
import { VoteButton } from "@/src/components/feature-requests/vote-button";
import { Card, CARD_PADDING, PageHeader, SectionTitle } from "@/src/components/ui/surfaces";
import { formatDateUS, todayIso } from "@/src/domain/dates";
import { backHref, LIST_PATH, votingOpen } from "@/src/domain/feature-requests";
import {
  FEATURE_REQUEST_STATUS_DESCRIPTIONS,
  FEATURE_REQUEST_STATUS_LABELS,
  pageTitle,
  UI,
} from "@/src/domain/strings";
import { pageSession } from "@/src/lib/page-session";
import { replyToFeatureRequestAction } from "@/src/modules/feature-requests/actions";
import { loadFeatureRequest } from "@/src/modules/feature-requests/queries";

/**
 * The same title for every request, never the request's own: a per-request title would put a
 * hidden request's words in the tab of anyone who typed its address (PHASE-17 P8).
 */
export const metadata = { title: pageTitle(UI.featureRequestsTitle) };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * One request (ticket §4). Its own organization sees who suggested it, what the status means,
 * and the conversation with a reply box; another organization sees only the title, details,
 * status and votes, because that is all `loadFeatureRequest` gives it. A request this
 * organization can't see is the same 404 as one that doesn't exist.
 */
export default async function FeatureRequestPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const session = await pageSession();
  const [{ id }, { back: backParam }] = await Promise.all([params, searchParams]);
  const request = await loadFeatureRequest(session, id);
  if (!request) notFound();

  const back = backHref(LIST_PATH, backParam);
  const own = request.kind === "own" ? request : null;

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={back}
        className="self-start inline-flex items-center gap-1.5 min-h-11 text-[15px] text-accent underline hover:text-accent-dark"
      >
        <svg viewBox="0 0 20 20" className="w-4 h-4 flex-none" aria-hidden="true">
          <path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {UI.featureRequestBack}
      </Link>

      <PageHeader
        className="mb-0 sm:mb-0"
        title={<span className="[overflow-wrap:anywhere]">{request.title}</span>}
        subtext={
          own ? UI.featureRequestSuggestedBy(own.authorName, formatDateUS(todayIso(own.createdAt))) : undefined
        }
        actions={
          votingOpen(request.status) ? <VoteButton requestId={request.id} voted={request.voted} /> : undefined
        }
      />

      <Card className={CARD_PADDING}>
        <p className="m-0 text-base text-ink leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {request.details}
        </p>
        <div className="mt-4 pt-4 border-t border-line text-[15px] text-sub">
          <span className="font-semibold text-ink">{FEATURE_REQUEST_STATUS_LABELS[request.status]}</span>
          {" · "}
          {UI.featureRequestVotes(request.votes)}
          {/* The status's meaning only for its own organization: two of them point to a reply,
              which another organization never sees. */}
          {own && <p className="mt-1 m-0">{FEATURE_REQUEST_STATUS_DESCRIPTIONS[own.status]}</p>}
          {own && !own.shownToAll && (
            <p className="mt-1 m-0 italic">
              {own.status === "waiting_for_review" ? UI.featureRequestWaitingNote : UI.featureRequestPrivateNote}
            </p>
          )}
        </div>
      </Card>

      {own && (
        <Card className={CARD_PADDING}>
          <SectionTitle className="mb-4">{UI.featureRequestRepliesTitle}</SectionTitle>
          <ReplyThread replies={own.replies} />
          <div className="mt-5">
            <ReplyForm requestId={own.id} label={UI.featureRequestReplyLabel} send={replyToFeatureRequestAction} />
          </div>
        </Card>
      )}
    </div>
  );
}
