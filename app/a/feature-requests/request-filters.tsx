"use client";

/**
 * The staff list's search box and two selects (ticket §6), the only client component on the
 * page, built the same way as the organizations list's `DirectoryFilters`: search waits two
 * seconds after typing stops, or runs at once on Enter, with a line under the box saying which.
 *
 * Every link is built by `staffListHref`, the same helper the page uses, so the two can't
 * disagree about the URL. Any change starts again at page 1.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Input, Label } from "@/src/components/ui/field";
import { Select } from "@/src/components/ui/select";
import type { FeatureRequestStatus } from "@/src/db/schema";
import {
  FEATURE_REQUEST_SEARCH_MAX,
  parseFeatureRequestStatus,
  staffListHref,
  type StaffFeatureRequestFilter,
} from "@/src/domain/feature-requests";
import { FEATURE_REQUEST_STATUS_LABELS, UI } from "@/src/domain/strings";

const SEARCH_DEBOUNCE_MS = 2000;

export function FeatureRequestFilters({ filter }: { filter: StaffFeatureRequestFilter }) {
  const router = useRouter();
  const [value, setValue] = useState(filter.q);
  const [pending, startTransition] = useTransition();
  const waitingToSearch = value.trim() !== filter.q;

  // The URL is the source of truth: when it changes underneath (Back, a new page), the box
  // follows it rather than holding a stale string.
  const lastPushed = useRef(filter.q);
  useEffect(() => {
    if (filter.q !== lastPushed.current) {
      lastPushed.current = filter.q;
      setValue(filter.q);
    }
  }, [filter.q]);

  function navigate(change: Partial<StaffFeatureRequestFilter>) {
    const next = { ...filter, q: value.trim(), ...change };
    lastPushed.current = next.q;
    startTransition(() => router.push(staffListHref(next, 1)));
  }

  useEffect(() => {
    if (value.trim() === filter.q) return;
    const timer = setTimeout(() => navigate({ q: value.trim() }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `navigate` closes over the current filters, which are what should be carried forward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, filter.q, filter.status, filter.attention]);

  return (
    <div className="flex flex-wrap gap-[18px]">
      <div className="flex-1 min-w-[240px] max-w-[340px]">
        <Label id="requestSearch-label" htmlFor="requestSearch">
          {UI.staffFeatureRequestsSearch}
        </Label>
        <Input
          id="requestSearch"
          type="search"
          aria-labelledby="requestSearch-label"
          maxLength={FEATURE_REQUEST_SEARCH_MAX}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              navigate({ q: value.trim() });
            }
          }}
        />
        <p className="text-[13px] text-sub mt-1 min-h-5" aria-live="polite">
          {pending ? UI.searching : waitingToSearch ? UI.searchPendingHint : ""}
        </p>
      </div>
      <div className="flex-1 min-w-[240px] max-w-[340px]">
        <Label id="requestStatus-label" htmlFor="requestStatus">
          {UI.staffFeatureRequestStatus}
        </Label>
        <Select
          id="requestStatus"
          aria-labelledby="requestStatus-label"
          value={filter.status ?? ""}
          onValueChange={(next) => navigate({ status: parseFeatureRequestStatus(next) })}
        >
          <option value="">{UI.staffFeatureRequestsAllStatuses}</option>
          {(Object.keys(FEATURE_REQUEST_STATUS_LABELS) as FeatureRequestStatus[]).map((key) => (
            <option key={key} value={key}>
              {FEATURE_REQUEST_STATUS_LABELS[key]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex-1 min-w-[240px] max-w-[340px]">
        <Label id="requestShow-label" htmlFor="requestShow">
          {UI.staffFeatureRequestsShow}
        </Label>
        <Select
          id="requestShow"
          aria-labelledby="requestShow-label"
          value={filter.attention ? "attention" : ""}
          onValueChange={(next) => navigate({ attention: next === "attention" })}
        >
          <option value="">{UI.staffFeatureRequestsAll}</option>
          <option value="attention">{UI.staffFeatureRequestsNeedsAttention}</option>
        </Select>
      </div>
    </div>
  );
}
