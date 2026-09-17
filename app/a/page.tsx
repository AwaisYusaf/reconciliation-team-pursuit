import Link from "next/link";

import { buttonClassName } from "@/src/components/ui/button";
import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatDateShort, todayIso } from "@/src/domain/dates";
import { PLAN_LABELS, STATUS_LABELS, UI } from "@/src/domain/strings";
import { cn } from "@/src/lib/cn";
import { parsePlanFilter, parseStatusFilter } from "@/src/modules/admin/directory";
import { requireStaffPage } from "@/src/modules/admin/guard";
import {
  loadOrgDirectory,
  loadOrgSummary,
  type OrgDirectoryFilter,
  type OrgPlanFilter,
  type OrgStatusFilter,
} from "@/src/modules/admin/queries";

import { AccountBadges } from "./badges";
import { DirectoryFilters } from "./directory-filters";

export const metadata = { title: "Organizations — AB Solutions admin" };

/**
 * The directory's state lives in the URL, not in component state: searching, filtering and
 * paging all run in the database (`loadOrgDirectory`), so each of them is a new request, and a
 * staff member can link someone straight to "suspended, page 2".
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A link that keeps the current query and changes one part of it. */
function withParams(
  current: OrgDirectoryFilter & { page?: number },
  change: Partial<OrgDirectoryFilter & { page: number }>,
): string {
  const next = { ...current, ...change };
  const params = new URLSearchParams();
  if (next.search) params.set("q", next.search);
  if (next.plan) params.set("plan", next.plan);
  if (next.status) params.set("status", next.status);
  if (next.badge) params.set("badge", next.badge);
  if (next.page && next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `/a?${query}` : "/a";
}

function SummaryTile({
  label,
  value,
  caption,
  active,
  href,
}: {
  label: string;
  value: number;
  caption: string;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      // `aria-current`, not `aria-pressed`: these are links, and `aria-pressed` is only
      // honoured on a button — a screen reader would announce eight identical links with no
      // way to tell which filter is applied. The focus ring is overridden on the active tile
      // because the global ring is the accent colour, which is this tile's own background.
      aria-current={active ? "true" : undefined}
      className={cn(
        "block rounded-[4px] border px-4 py-3.5 transition-colors",
        active
          ? "border-accent bg-accent text-surface focus-visible:outline-surface"
          : "border-line bg-surface hover:bg-section",
      )}
    >
      <div className={cn("text-[13px] leading-snug", active ? "text-surface/85" : "text-sub")}>{label}</div>
      <div
        className={cn(
          "text-[26px] font-bold tabular-nums leading-none mt-1.5",
          // A zero recedes rather than shouting: most of these are zero most of the time.
          !active && value === 0 && "text-muted",
        )}
      >
        {value}
      </div>
      <div className={cn("text-[12px] mt-2 uppercase tracking-[0.04em]", active ? "text-surface/75" : "text-muted")}>
        {caption}
      </div>
    </Link>
  );
}

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  // The layout also checks, but Next 16 layouts don't re-render on navigation, so the page
  // checks too (Phase 9, D-98).
  await requireStaffPage();

  const params = await searchParams;
  const planParam = one(params.plan);
  const statusParam = one(params.status);
  const badgeParam = one(params.badge);

  // Anything unrecognised in the URL is dropped rather than passed to a query as an enum.
  const filter: OrgDirectoryFilter = {
    search: one(params.q) ?? "",
    plan: parsePlanFilter(planParam),
    status: parseStatusFilter(statusParam),
    badge: badgeParam === "complimentary" || badgeParam === "suspended" ? badgeParam : null,
  };
  const requestedPage = Number(one(params.page) ?? "1");

  const [summary, directory] = await Promise.all([
    loadOrgSummary(),
    loadOrgDirectory(filter, Number.isFinite(requestedPage) ? requestedPage : 1),
  ]);
  const today = todayIso();
  const current = { ...filter, page: directory.page };
  const hasFilter = Boolean(filter.search || filter.plan || filter.status || filter.badge);
  // Carried into each row link so the organization page can send the reader back to the list
  // they were actually looking at, not an unfiltered page 1.
  const backQuery = withParams(current, {}).slice("/a".length);

  return (
    <div>
      <PageTitle className="mb-2">Organizations</PageTitle>
      <Subtext className="mb-6">Every organization on the app, its plan, status and access.</Subtext>

      {/* Four across on desktop, two on tablet. Clicking a tile filters; clicking the active
          one clears it. They are links, so the filter is shareable and the back button works. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.keys(PLAN_LABELS) as OrgPlanFilter[]).map((key) => (
          <SummaryTile
            key={key}
            label={PLAN_LABELS[key]}
            value={summary.plan[key]}
            caption="Plan"
            active={filter.plan === key}
            href={withParams(current, { plan: filter.plan === key ? null : key, page: 1 })}
          />
        ))}
        <SummaryTile
          label={UI.complimentaryLabel}
          value={summary.complimentary}
          caption="Access"
          active={filter.badge === "complimentary"}
          href={withParams(current, {
            badge: filter.badge === "complimentary" ? null : "complimentary",
            page: 1,
          })}
        />
        <SummaryTile
          label={UI.suspendedLabel}
          value={summary.suspended}
          caption="Access"
          active={filter.badge === "suspended"}
          href={withParams(current, { badge: filter.badge === "suspended" ? null : "suspended", page: 1 })}
        />
        {(Object.keys(STATUS_LABELS) as OrgStatusFilter[]).map((key) => (
          <SummaryTile
            key={key}
            label={STATUS_LABELS[key]}
            value={summary.status[key]}
            caption="Status"
            active={filter.status === key}
            href={withParams(current, { status: filter.status === key ? null : key, page: 1 })}
          />
        ))}
      </div>

      <div className="mt-6">
        <DirectoryFilters
          search={filter.search ?? ""}
          plan={filter.plan ?? null}
          status={filter.status ?? null}
        />
      </div>

      <div className="text-[15px] text-sub mt-6 mb-3">{UI.organizationsCount(directory.total)}</div>

      <TableCard minWidth={900}>
        <thead>
          <tr>
            {/* Pinned like every other identity column in the app: the table scrolls sideways
                at 768px, and unpinned the plan and status belong to no visible organization. */}
            <Th sticky>Organization</Th>
            <Th>Signed up</Th>
            <Th>Plan</Th>
            <Th>Status</Th>
            <Th align="right">Users</Th>
            <Th>Last sign-in</Th>
          </tr>
        </thead>
        <tbody>
          {directory.rows.length === 0 ? (
            <tr>
              <Td colSpan={6} className="text-sub">
                {/* A fresh install has no organizations and no filter — telling that reader
                    "nothing matches these filters" describes a state they aren't in. */}
                {hasFilter ? UI.noOrganizationsMatch : UI.noOrganizationsYet}
              </Td>
            </tr>
          ) : (
            directory.rows.map((row) => (
              <tr key={row.id} className="hover:bg-section">
                <Td sticky>
                  {/* Negative-margin trick: fills the cell exactly (matching `Td`'s own
                      padding) rather than overriding it, since `cn` doesn't de-dupe utilities
                      and two conflicting padding classes on one element race on stylesheet
                      order. */}
                  <Link
                    href={`/a/orgs/${row.id}${backQuery ? `?back=${encodeURIComponent(backQuery)}` : ""}`}
                    className="-mx-3 -my-3 sm:-mx-4 sm:-my-3.5 block px-3 sm:px-4 py-3 sm:py-3.5 text-accent font-semibold underline underline-offset-2 hover:no-underline"
                  >
                    {row.name}
                  </Link>
                </Td>
                <Td>{formatDateShort(todayIso(row.createdAt))}</Td>
                <Td>{PLAN_LABELS[row.plan]}</Td>
                <Td>
                  <AccountBadges org={row} today={today} />
                </Td>
                <Td align="right" numeric>
                  {row.userCount}
                </Td>
                <Td>{row.lastSignInAt ? formatDateShort(todayIso(row.lastSignInAt)) : UI.notRecordedYet}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableCard>

      {directory.pageCount > 1 && (
        <nav aria-label="Pages" className="mt-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="text-[15px] text-sub">
            {UI.pageOf(directory.page, directory.pageCount)}
          </div>
          <div className="flex items-center gap-2">
            {directory.page > 1 ? (
              <Link
                href={withParams(current, { page: directory.page - 1 })}
                className={buttonClassName("secondary", "min-h-11 px-4 text-[15px] no-underline")}
              >
                Previous
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className={buttonClassName("secondary", "min-h-11 px-4 text-[15px] opacity-50")}
              >
                Previous
              </span>
            )}
            {directory.page < directory.pageCount ? (
              <Link
                href={withParams(current, { page: directory.page + 1 })}
                className={buttonClassName("secondary", "min-h-11 px-4 text-[15px] no-underline")}
              >
                Next
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className={buttonClassName("secondary", "min-h-11 px-4 text-[15px] opacity-50")}
              >
                Next
              </span>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
