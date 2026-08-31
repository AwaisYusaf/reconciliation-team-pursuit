"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { monthLabel, monthsByYear } from "@/src/domain/dates";
import { Select } from "@/src/components/ui/select";
import { reportResult } from "@/src/components/ui/toast";
import { setActiveMonthAction } from "@/src/modules/auth/actions";

/**
 * The app-wide month selector (R2.3). Changing it persists the choice on the
 * organisation and re-renders every screen through the router.
 *
 * The list covers the contract's own months plus a rolling window, grouped by year so a
 * multi-year contract stays scannable. "Other month…" opens a free month picker for
 * anything outside it — back-entry before the contract, or past its end (D-14/D-30).
 */
const OTHER = "__other__";

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
      <label id="month-selector-label" htmlFor="month-selector" className="block text-[15px] font-semibold text-ink">
        Month
      </label>
      <Select
        id="month-selector"
        aria-labelledby="month-selector-label"
        value={activeMonth}
        disabled={pending}
        onValueChange={(value) => {
          if (value === OTHER) {
            setShowPicker(true);
            return;
          }
          apply(value);
        }}
        className="w-[200px]"
      >
        {monthsByYear(months).map((group) => (
          <optgroup key={group.year} label={group.year}>
            {group.months.map((month) => (
              <option key={month} value={month}>
                {monthLabel(month)}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={OTHER}>Other month…</option>
      </Select>

      {showPicker && (
        <div className="flex items-center gap-2">
          <input
            type="month"
            aria-label="Choose any other month"
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
