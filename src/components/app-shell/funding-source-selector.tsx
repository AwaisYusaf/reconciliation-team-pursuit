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
}: {
  sources: readonly FundingSource[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex flex-col gap-1.5">
      <label
        id="funding-source-selector-label"
        htmlFor="funding-source-selector"
        className="block text-[15px] font-semibold text-ink"
      >
        Funding source
      </label>
      <Select
        id="funding-source-selector"
        aria-labelledby="funding-source-selector-label"
        value={selectedId ?? ALL}
        disabled={pending}
        onValueChange={apply}
        className="w-[220px]"
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

      {error && <div className="text-[15px] text-danger">{error}</div>}
    </div>
  );
}
