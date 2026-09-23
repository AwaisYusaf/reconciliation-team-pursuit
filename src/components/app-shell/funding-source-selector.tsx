"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Select } from "@/src/components/ui/select";
import { reportResult } from "@/src/components/ui/toast";
import { setActiveFundingSourceAction } from "@/src/modules/auth/actions";
import type { FundingSource } from "@/src/db/schema";

/** Persist-then-refresh, same shape as `MonthSelector` (R2.3). Hidden entirely for a
 *  single-source org — `app/r/layout.tsx` only renders this when `!single`. */
const ALL = "__all__";

export function FundingSourceSelector({
  sources,
  selectedId,
  compact = false,
}: {
  sources: readonly FundingSource[];
  selectedId: string | null;
  /** Header pill form, matching `MonthSelector`: no stacked label, named by `aria-label`. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Review fix: history and documents stay after archiving (spec §1), and that only holds if
  // an archived source is still reachable to view them — omitting it here is what made an
  // old packet undownloadable the moment its source was archived. Active sources list first;
  // archived ones stay selectable, grouped separately, view-only (no new expenses/line items).
  const active = sources.filter((source) => source.archivedAt === null);
  const archived = sources.filter((source) => source.archivedAt !== null);

  function apply(value: string) {
    setError(null);
    startTransition(async () => {
      const result = await setActiveFundingSourceAction(value === ALL ? null : value);
      if (reportResult(result)) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className={compact ? "flex flex-col gap-1.5 relative" : "flex flex-col gap-1.5"}>
      {!compact && (
        <label
          id="funding-source-selector-label"
          htmlFor="funding-source-selector"
          className="block text-[15px] font-semibold text-ink"
        >
          Funding source
        </label>
      )}
      <Select
        id="funding-source-selector"
        aria-label={compact ? "Funding source" : undefined}
        aria-labelledby={compact ? undefined : "funding-source-selector-label"}
        value={selectedId ?? ALL}
        disabled={pending}
        compact={compact}
        onValueChange={apply}
        // Matches `MonthSelector`: shares the phone's row, fixed width from `sm`.
        className={compact ? "w-full sm:w-[190px]" : "w-[220px]"}
      >
        <option value={ALL}>All funding sources</option>
        {active.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
        {archived.length > 0 && (
          <optgroup label="Archived">
            {archived.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </optgroup>
        )}
      </Select>

      {/* Floated in compact form, so an error cannot grow the header row. */}
      {error && (
        <div
          className={
            compact
              ? "absolute top-full right-0 mt-1 z-40 text-[13px] text-danger bg-surface border border-danger rounded-[8px] px-2.5 py-1.5 whitespace-nowrap"
              : "text-[15px] text-danger"
          }
        >
          {error}
        </div>
      )}
    </div>
  );
}
