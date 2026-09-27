import Link from "next/link";

import { AdminSectionLinks } from "@/src/components/admin/section-links";
import { Badge } from "@/src/components/ui/badge";
import { Pagination } from "@/src/components/ui/pagination";
import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatDateShort, todayIso } from "@/src/domain/dates";
import { parseStaffFilter, staffListHref } from "@/src/domain/feature-requests";
import { FEATURE_REQUEST_STATUS_LABELS, UI } from "@/src/domain/strings";
import { userDisplay } from "@/src/domain/user-display";
import { requireStaffPage } from "@/src/modules/admin/guard";
import {
  countFeatureRequestsNeedingAttention,
  loadStaffFeatureRequests,
} from "@/src/modules/feature-requests/staff-queries";

import { FeatureRequestFilters } from "./request-filters";

export const metadata = { title: "Feature requests | AB Solutions admin" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Every organization's feature requests, newest first (PHASE-17, ticket §6). Searched,
 * filtered, counted and paged in the database with the state in the URL, like the
 * organizations list (D-102).
 */
export default async function StaffFeatureRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  // The layout checks too, but a layout doesn't re-render on navigation (D-98).
  await requireStaffPage();

  const { filter, page } = parseStaffFilter(await searchParams);
  const [list, attention] = await Promise.all([
    loadStaffFeatureRequests(filter, page),
    countFeatureRequestsNeedingAttention(),
  ]);
  const hasFilter = Boolean(filter.q || filter.status || filter.attention);
  // Carried into each row link so the request's page returns to this filtered, paged list.
  const backQuery = staffListHref(filter, list.page).slice("/a/feature-requests".length);

  return (
    <div>
      <AdminSectionLinks current="feature-requests" attention={attention} />
      <PageTitle gradient className="mb-2">
        {UI.staffSectionFeatureRequests}
      </PageTitle>
      <Subtext className="mb-6">{UI.staffFeatureRequestsIntro}</Subtext>

      <FeatureRequestFilters filter={filter} />

      <div className="text-[15px] text-sub mt-6 mb-3">{UI.staffFeatureRequestsCount(list.total)}</div>

      <TableCard minWidth={960}>
        <thead>
          <tr>
            <Th sticky>Request</Th>
            <Th>Organization</Th>
            <Th>Suggested by</Th>
            <Th>Date</Th>
            <Th align="right">Votes</Th>
            <Th>Status</Th>
            <Th>Shown to all</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <tr>
              <Td colSpan={7} className="text-sub">
                {hasFilter ? UI.staffFeatureRequestsNoneMatch : UI.staffFeatureRequestsNoneYet}
              </Td>
            </tr>
          ) : (
            list.rows.map((row) => (
              <tr key={row.id} className="hover:bg-section">
                <Td sticky className="max-w-[320px]">
                  <Link
                    href={`/a/feature-requests/${row.id}${backQuery ? `?back=${encodeURIComponent(backQuery)}` : ""}`}
                    className="text-accent font-semibold underline underline-offset-2 hover:no-underline [overflow-wrap:anywhere]"
                  >
                    {row.title}
                  </Link>
                </Td>
                <Td className="[overflow-wrap:anywhere]">
                  <Link href={`/a/orgs/${row.orgId}`} className="text-ink underline underline-offset-2 hover:text-accent">
                    {row.orgName}
                  </Link>
                </Td>
                <Td className="[overflow-wrap:anywhere]">
                  {row.authorEmail ? userDisplay(row.authorName, row.authorEmail) : UI.staffFeatureRequestUnknownPerson}
                </Td>
                <Td>{formatDateShort(todayIso(row.createdAt))}</Td>
                <Td align="right" numeric>
                  {row.votes}
                </Td>
                <Td>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {FEATURE_REQUEST_STATUS_LABELS[row.status]}
                    {row.needsAttention && <Badge tone="warning">{UI.staffFeatureRequestsNeedsAttention}</Badge>}
                  </span>
                </Td>
                <Td>{row.shownToAll ? UI.staffFeatureRequestYes : UI.staffFeatureRequestNo}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableCard>

      <Pagination page={list.page} pageCount={list.pageCount} hrefFor={(next) => staffListHref(filter, next)} />
    </div>
  );
}
