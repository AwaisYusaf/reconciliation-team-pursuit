import Link from "next/link";
import { notFound } from "next/navigation";

import { ReplyForm } from "@/src/components/feature-requests/reply-form";
import { ReplyThread } from "@/src/components/feature-requests/reply-thread";
import { Card, PageTitle, SubsectionTitle } from "@/src/components/ui/surfaces";
import { formatDateShort, todayIso } from "@/src/domain/dates";
import { backHref } from "@/src/domain/feature-requests";
import { UI } from "@/src/domain/strings";
import { userDisplay } from "@/src/domain/user-display";
import { requireStaffPage } from "@/src/modules/admin/guard";
import { staffReplyToFeatureRequestAction } from "@/src/modules/feature-requests/staff-actions";
import { loadStaffFeatureRequest } from "@/src/modules/feature-requests/staff-queries";

import { EditWording, StatusAndVisibility } from "./staff-controls";

export const metadata = { title: "Feature request | AB Solutions admin" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const CARD = "p-4 sm:p-5 lg:p-6";

/**
 * One feature request as staff see it (PHASE-17, ticket §7): everything, including who asked,
 * the customer's original wording once it has been edited, and which organizations voted.
 */
export default async function StaffFeatureRequestPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireStaffPage();

  const [{ id }, { back }] = await Promise.all([params, searchParams]);
  const request = await loadStaffFeatureRequest(id);
  if (!request) notFound();

  const author = request.authorEmail
    ? `${userDisplay(request.authorName, request.authorEmail)} (${request.authorEmail})`
    : UI.staffFeatureRequestUnknownPerson;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={backHref("/a/feature-requests", back)}
          className="inline-flex items-center gap-1.5 text-[15px] text-sub hover:text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {UI.staffFeatureRequestsAll}
        </Link>
      </div>

      <Card className={CARD}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-3">
          <PageTitle gradient className="[overflow-wrap:anywhere] min-w-0">
            {request.title}
          </PageTitle>
          <EditWording requestId={request.id} title={request.title} details={request.details} />
        </div>
        <p className="m-0 text-base text-ink leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {request.details}
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 mt-5">
          <div>
            <dt className="text-[13px] text-sub">{UI.staffFeatureRequestOrganization}</dt>
            <dd className="text-[15px] text-ink font-medium [overflow-wrap:anywhere]">
              <Link href={`/a/orgs/${request.orgId}`} className="underline underline-offset-2 hover:text-accent">
                {request.orgName}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-sub">{UI.staffFeatureRequestSuggestedBy}</dt>
            <dd className="text-[15px] text-ink font-medium [overflow-wrap:anywhere]">{author}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-sub">{UI.staffFeatureRequestSuggestedOn}</dt>
            <dd className="text-[15px] text-ink font-medium">{formatDateShort(todayIso(request.createdAt))}</dd>
          </div>
        </dl>
        {request.originalTitle !== null && (
          <div className="mt-5 rounded-[8px] bg-section border border-line px-3.5 py-3">
            <div className="text-[13px] text-sub font-semibold mb-1">{UI.staffFeatureRequestOriginal}</div>
            <p className="m-0 text-[15px] text-ink font-semibold [overflow-wrap:anywhere]">{request.originalTitle}</p>
            <p className="m-0 mt-1 text-[15px] text-ink leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
              {request.originalDetails}
            </p>
          </div>
        )}
      </Card>

      <Card className={CARD}>
        <SubsectionTitle gradient className="mb-3">
          {UI.staffFeatureRequestStatusTitle}
        </SubsectionTitle>
        <StatusAndVisibility requestId={request.id} status={request.status} shownToAll={request.shownToAll} />
      </Card>

      <Card className={CARD}>
        <SubsectionTitle gradient className="mb-2">
          {UI.staffFeatureRequestVotesTitle}
        </SubsectionTitle>
        <p className="m-0 text-[15px] text-ink">
          {UI.staffFeatureRequestVotesFrom(request.votes, request.votesByOrg.length)}
        </p>
        {request.votesByOrg.length > 0 && (
          <ul className="mt-2 divide-y divide-line">
            {request.votesByOrg.map((org) => (
              <li key={org.orgId} className="py-2 flex items-center justify-between gap-4 text-[15px]">
                <Link href={`/a/orgs/${org.orgId}`} className="underline underline-offset-2 hover:text-accent [overflow-wrap:anywhere]">
                  {org.orgName}
                </Link>
                <span className="text-sub tabular-nums">{UI.featureRequestVotes(org.votes)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className={CARD}>
        <SubsectionTitle gradient className="mb-3">
          {UI.featureRequestRepliesTitle}
        </SubsectionTitle>
        <ReplyThread replies={request.replies} />
        <div className="mt-5">
          <ReplyForm
            requestId={request.id}
            label={UI.staffFeatureRequestReplyTo(request.orgName)}
            send={staffReplyToFeatureRequestAction}
          />
        </div>
      </Card>
    </div>
  );
}
