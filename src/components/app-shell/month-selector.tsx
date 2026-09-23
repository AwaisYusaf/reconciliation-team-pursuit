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
  compact = false,
}: {
  months: readonly string[];
  activeMonth: string;
  /**
   * Header pill form: no stacked label, and the control names itself through `aria-label`
   * instead. The visible word "Month" is dropped, not the accessible one, so the control is
   * still announced as what it is.
   */
  compact?: boolean;
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
    <div className={compact ? "flex flex-col gap-1.5 relative" : "flex flex-col gap-1.5"}>
      {!compact && (
        <label id="month-selector-label" htmlFor="month-selector" className="block text-[15px] font-semibold text-ink">
          Month
        </label>
      )}
      <Select
        id="month-selector"
        aria-label={compact ? "Month" : undefined}
        aria-labelledby={compact ? undefined : "month-selector-label"}
        value={activeMonth}
        disabled={pending}
        compact={compact}
        onValueChange={(value) => {
          if (value === OTHER) {
            setShowPicker(true);
            return;
          }
          apply(value);
        }}
        // Full width of its share of the row on a phone, fixed from `sm`. The header gives the
        // two compact selectors one line between them at every width.
        className={compact ? "w-full sm:w-[150px]" : "w-[200px]"}
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

      {/*
        Floated in compact form. These two are conditional and would otherwise add their own
        height to the header row the moment they appear, shunting the page down mid-interaction.
      */}
      {showPicker && (
        <div
          className={
            compact
              ? "absolute top-full right-0 mt-1 z-40 flex items-center gap-2 bg-surface border border-line rounded-[10px] p-2 shadow-lg whitespace-nowrap"
              : "flex items-center gap-2"
          }
        >
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
