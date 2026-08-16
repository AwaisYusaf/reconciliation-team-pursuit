"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { monthLabel } from "@/src/domain/dates";
import { reportResult } from "@/src/components/ui/toast";
import { setActiveMonthAction } from "@/src/modules/auth/actions";

/**
 * The app-wide month selector (R2.3). Changing it persists the choice on the
 * organisation and re-renders every screen through the router.
 *
 * "Earlier month…" opens a free month picker so months older than the rolling window
 * stay reachable for back-entry (D-14/D-27).
 */
const EARLIER = "__earlier__";

export function MonthSelector({
  months,
  activeMonth,
}: {
  months: readonly string[];
  activeMonth: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(month: string) {
    setError(null);
    startTransition(async () => {
      const result = await setActiveMonthAction(month);
      if (reportResult(result)) {
        setShowPicker(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="month-selector" className="block text-[15px] font-semibold text-ink">
        Month
      </label>
      <select
        id="month-selector"
        value={activeMonth}
        disabled={pending}
        onChange={(event) => {
          const value = event.target.value;
          if (value === EARLIER) {
            setShowPicker(true);
            return;
          }
          apply(value);
        }}
        className="w-[200px] min-h-11 px-3 py-[11px] text-base font-sans text-ink bg-surface border border-line rounded-[3px] disabled:opacity-60"
      >
        {months.map((month) => (
          <option key={month} value={month}>
            {monthLabel(month)}
          </option>
        ))}
        <option value={EARLIER}>Earlier month…</option>
      </select>

      {showPicker && (
        <div className="flex items-center gap-2">
          <input
            type="month"
            aria-label="Choose an earlier month"
            defaultValue={activeMonth}
            onChange={(event) => {
              if (event.target.value) apply(event.target.value);
            }}
            className="min-h-11 px-3 py-2 text-base font-sans text-ink bg-surface border border-line rounded-[3px]"
          />
          <button
            type="button"
            onClick={() => setShowPicker(false)}
            className="text-[15px] text-accent underline"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <div className="text-[15px] text-danger">{error}</div>}
    </div>
  );
}
