"use client";

/**
 * The directory's search box and two filter selects. The only client component on the page —
 * everything else (counts, table, pagination) is rendered on the server from the URL, because
 * the query itself runs in the database.
 *
 * Search waits for typing to stop before navigating: a request per keystroke would be a query
 * per keystroke, and the page re-renders from the server on each one.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Input, Label } from "@/src/components/ui/field";
import { Select } from "@/src/components/ui/select";
import { PLAN_LABELS, STATUS_LABELS, UI } from "@/src/domain/strings";
import type { OrgPlanFilter, OrgStatusFilter } from "@/src/modules/admin/queries";

/** How long typing has to stop before the search runs. */
const SEARCH_DEBOUNCE_MS = 2000;

export function DirectoryFilters({
  search,
  plan,
  status,
}: {
  search: string;
  plan: OrgPlanFilter | null;
  status: OrgStatusFilter | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(search);
  // Every filter is now a server round-trip, and the search one only starts after two seconds
  // of no typing. Without something on screen saying so, both read as a dead control.
  const [pending, startTransition] = useTransition();
  const waitingToSearch = value.trim() !== search;

  // The URL is the source of truth: when it changes under us (a card click, Back, a cleared
  // filter) the box follows it rather than holding a stale string.
  const lastPushed = useRef(search);
  useEffect(() => {
    if (search !== lastPushed.current) {
      lastPushed.current = search;
      setValue(search);
    }
  }, [search]);

  function navigate(next: { search?: string; plan?: OrgPlanFilter | null; status?: OrgStatusFilter | null }) {
    const params = new URLSearchParams();
    const nextSearch = next.search ?? value;
    const nextPlan = next.plan === undefined ? plan : next.plan;
    const nextStatus = next.status === undefined ? status : next.status;

    if (nextSearch.trim()) params.set("q", nextSearch.trim());
    if (nextPlan) params.set("plan", nextPlan);
    if (nextStatus) params.set("status", nextStatus);
    // Any change to the filters starts again at page 1: page 3 of the old result set says
    // nothing about the new one, and an out-of-range page would clamp anyway.
    const badge = new URLSearchParams(window.location.search).get("badge");
    if (badge) params.set("badge", badge);

    lastPushed.current = nextSearch.trim();
    const query = params.toString();
    startTransition(() => router.push(query ? `/a?${query}` : "/a"));
  }

  useEffect(() => {
    if (value.trim() === search) return; // already showing these results
    const timer = setTimeout(() => navigate({ search: value }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `navigate` closes over the current filters, which are exactly what should be carried
    // forward; re-creating the timer when they change is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, search, plan, status]);

  return (
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
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // Enter searches at once rather than waiting out the delay.
            if (event.key === "Enter") {
              event.preventDefault();
              navigate({ search: value });
            }
          }}
        />
        <p className="text-[13px] text-sub mt-1 min-h-5" aria-live="polite">
          {pending ? UI.searching : waitingToSearch ? UI.searchPendingHint : ""}
        </p>
      </div>
      <div className="flex-1 min-w-[240px] max-w-[340px]">
        <Label id="planFilter-label" htmlFor="planFilter">
          Filter by plan
        </Label>
        <Select
          id="planFilter"
          aria-labelledby="planFilter-label"
          value={plan ?? ""}
          onValueChange={(next) => navigate({ plan: next === "" ? null : (next as OrgPlanFilter) })}
        >
          <option value="">All plans</option>
          {(Object.keys(PLAN_LABELS) as OrgPlanFilter[]).map((key) => (
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
          onValueChange={(next) => navigate({ status: next === "" ? null : (next as OrgStatusFilter) })}
        >
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABELS) as OrgStatusFilter[]).map((key) => (
            <option key={key} value={key}>
              {STATUS_LABELS[key]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
