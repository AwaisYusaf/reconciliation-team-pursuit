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

/**
 * One count, as a filter tile: label on top, the number large beneath it, and the group it
 * belongs to as a caption at the foot — which is what carries "this is a plan / a status"
 * without a separate heading row per group. The selected tile fills with the accent, so which
 * filter is on is readable at a glance from across the table.
 */
function SummaryTile({
  label,
  value,
  caption,
  active,
  onClick,
}: {
  label: string;
  value: number;
  caption: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "text-left rounded-[4px] border px-4 py-3.5 transition-colors",
        active ? "border-accent bg-accent text-surface" : "border-line bg-surface hover:bg-section",
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
      <div
        className={cn(
          "text-[12px] mt-2 uppercase tracking-[0.04em]",
          active ? "text-surface/75" : "text-muted",
        )}
      >
        {caption}
      </div>
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
      {/* Four across on desktop, two on tablet: eight tiles in two tidy rows rather than three
          ragged group rows of two, four and two. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.keys(PLAN_LABELS) as OrgPlan[]).map((key) => (
          <SummaryTile
            key={key}
            label={PLAN_LABELS[key]}
            value={summary.plan[key]}
            caption="Plan"
            active={plan === key}
            onClick={() => setPlan((current) => toggleFilterValue(current, key))}
          />
        ))}
        <SummaryTile
          label={UI.complimentaryLabel}
          value={summary.complimentary}
          caption="Access"
          active={badge === "complimentary"}
          onClick={() => setBadge((current) => toggleFilterValue(current, "complimentary"))}
        />
        <SummaryTile
          label={UI.suspendedLabel}
          value={summary.suspended}
          caption="Access"
          active={badge === "suspended"}
          onClick={() => setBadge((current) => toggleFilterValue(current, "suspended"))}
        />
        {(Object.keys(STATUS_LABELS) as SubscriptionStatus[]).map((key) => (
          <SummaryTile
            key={key}
            label={STATUS_LABELS[key]}
            value={summary.status[key]}
            caption="Status"
            active={status === key}
            onClick={() => setStatus((current) => toggleFilterValue(current, key))}
          />
        ))}
      </div>

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
