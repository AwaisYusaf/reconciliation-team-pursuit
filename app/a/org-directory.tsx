"use client";

/**
 * The `/a` organizations list (Phase 9 §6): summary cards, search + filters, and the table.
 * Filtering and counting both run through `filterOrgs`/`summarize` (`src/modules/admin/directory.ts`)
 * so "counts match the list" holds by construction (§3.9).
 */
import Link from "next/link";
import { useMemo, useState } from "react";

import { Input, Label } from "@/src/components/ui/field";
import { Select } from "@/src/components/ui/select";
import { Card, SubsectionTitle } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import type { IsoDate } from "@/src/domain/dates";
import { formatDateShort, todayIso } from "@/src/domain/dates";
import { PLAN_LABELS, STATUS_LABELS, UI } from "@/src/domain/strings";
import { cn } from "@/src/lib/cn";
import {
  filterOrgs,
  summarize,
  toggleFilterValue,
  type OrgPlan,
  type SubscriptionStatus,
} from "@/src/modules/admin/directory";
import type { OrgDirectoryRow } from "@/src/modules/admin/queries";

import { AccountBadges } from "./badges";

type OtherFilter = "complimentary" | "suspended";

function SummaryCard({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        // Capped as well as flexed: Appendix A §3 calls these "small cards", and without a
        // maximum the two-card rows (By plan, Other) stretched to the full content width while
        // the four-card status row stayed narrow, so the three rows didn't line up.
        "text-left flex-1 min-w-[160px] max-w-[260px] rounded-[4px] border bg-surface px-5 py-[18px] transition-colors",
        active ? "border-accent ring-1 ring-accent" : "border-line hover:bg-section",
      )}
    >
      <div className="text-[13px] text-sub leading-snug">{label}</div>
      <div className="text-xl font-bold tabular-nums mt-2">{value}</div>
    </button>
  );
}

export function OrgDirectory({ rows, today }: { rows: OrgDirectoryRow[]; today: IsoDate }) {
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState<OrgPlan | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [badge, setBadge] = useState<OtherFilter | null>(null);

  // Always over every row — never the filtered subset (§7 Q10).
  const summary = useMemo(() => summarize(rows, today), [rows, today]);
  const visible = useMemo(
    () => filterOrgs(rows, { search, plan, status, badge }, today),
    [rows, search, plan, status, badge, today],
  );

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4 sm:p-5 flex flex-col gap-4">
        <div>
          <SubsectionTitle className="mb-2">By plan</SubsectionTitle>
          <div className="flex flex-wrap gap-3">
            {(Object.keys(PLAN_LABELS) as OrgPlan[]).map((key) => (
              <SummaryCard
                key={key}
                label={PLAN_LABELS[key]}
                value={summary.plan[key]}
                active={plan === key}
                onClick={() => setPlan((current) => toggleFilterValue(current, key))}
              />
            ))}
          </div>
        </div>
        <div>
          <SubsectionTitle className="mb-2">By status</SubsectionTitle>
          <div className="flex flex-wrap gap-3">
            {(Object.keys(STATUS_LABELS) as SubscriptionStatus[]).map((key) => (
              <SummaryCard
                key={key}
                label={STATUS_LABELS[key]}
                value={summary.status[key]}
                active={status === key}
                onClick={() => setStatus((current) => toggleFilterValue(current, key))}
              />
            ))}
          </div>
        </div>
        <div>
          <SubsectionTitle className="mb-2">Other</SubsectionTitle>
          <div className="flex flex-wrap gap-3">
            <SummaryCard
              label={UI.complimentaryLabel}
              value={summary.complimentary}
              active={badge === "complimentary"}
              onClick={() => setBadge((current) => toggleFilterValue(current, "complimentary"))}
            />
            <SummaryCard
              label={UI.suspendedLabel}
              value={summary.suspended}
              active={badge === "suspended"}
              onClick={() => setBadge((current) => toggleFilterValue(current, "suspended"))}
            />
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-[18px]">
        <div className="flex-1 min-w-[240px] max-w-[340px]">
          <Label id="orgSearch-label" htmlFor="orgSearch">
            Search organizations
          </Label>
          <Input
            id="orgSearch"
            type="search"
            aria-labelledby="orgSearch-label"
            placeholder="Organization name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex-1 min-w-[240px] max-w-[340px]">
          <Label id="planFilter-label" htmlFor="planFilter">
            Filter by plan
          </Label>
          <Select
            id="planFilter"
            aria-labelledby="planFilter-label"
            value={plan ?? ""}
            onValueChange={(value) => setPlan(value === "" ? null : (value as OrgPlan))}
          >
            <option value="">All plans</option>
            {(Object.keys(PLAN_LABELS) as OrgPlan[]).map((key) => (
              <option key={key} value={key}>
                {PLAN_LABELS[key]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-1 min-w-[240px] max-w-[340px]">
          <Label id="statusFilter-label" htmlFor="statusFilter">
            Filter by status
          </Label>
          <Select
            id="statusFilter"
            aria-labelledby="statusFilter-label"
            value={status ?? ""}
            onValueChange={(value) => setStatus(value === "" ? null : (value as SubscriptionStatus))}
          >
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABELS) as SubscriptionStatus[]).map((key) => (
              <option key={key} value={key}>
                {STATUS_LABELS[key]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="text-[15px] text-sub">{UI.organizationsCount(visible.length)}</div>

      <TableCard minWidth={900}>
        <thead>
          <tr>
            <Th>Organization</Th>
            <Th>Signed up</Th>
            <Th>Plan</Th>
            <Th>Status</Th>
            <Th align="right">Users</Th>
            <Th>Last sign-in</Th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <Td colSpan={6} className="text-sub">
                {UI.noOrganizationsMatch}
              </Td>
            </tr>
          ) : (
            visible.map((row) => (
              <tr key={row.id} className="hover:bg-section">
                <Td>
                  {/* Negative-margin trick: fills the cell exactly (matching `Td`'s own
                      padding) rather than overriding it, since `cn` doesn't de-dupe utilities
                      and two conflicting padding classes on one element race on stylesheet
                      order. */}
                  <Link
                    href={`/a/orgs/${row.id}`}
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
    </div>
  );
}
