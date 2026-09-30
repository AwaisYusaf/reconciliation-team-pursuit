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
   * Pill form, for the corner of the content column: a smaller control under a smaller label.
   *
   * The label is smaller here, not absent. It was dropped entirely at one point on the theory
   * that an `aria-label` covered it, which confuses two different jobs: a screen reader was
   * told what the control was, and everyone else was left with two unlabelled pills reading
   * "June 2026" and "All funding sources" side by side, with nothing saying which was the
   * month and which was the funding source.
   */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showPicker, setShowPicker] = useState(false);

  function apply(month: string) {
    startTransition(async () => {
      const result = await setActiveMonthAction(month);
      // A toast, not a line under the picker: in the header a line of text has no room on a
      // phone, and it covered the "Other month" box (PR #27).
      if (!result.ok) {
        reportResult(result);
        return;
      }
      setShowPicker(false);
      router.refresh();
    });
  }

  return (
    <div className={compact ? "flex flex-col gap-1 relative" : "flex flex-col gap-1.5"}>
      <label
        id="month-selector-label"
        htmlFor="month-selector"
        className={
          compact
            ? "block text-[12px] font-semibold text-sub leading-none"
            : "block text-[15px] font-semibold text-ink"
        }
      >
        Month
      </label>
      <Select
        id="month-selector"
        aria-labelledby="month-selector-label"
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
        // two compact selectors one line between them at every width. Sized for the longest
        // label, "September 2026": 114px of text plus padding, gap, chevron and border is 164px,
        // and 150 cut every month from July on to "November 2…".
        className={compact ? "w-full sm:w-[172px]" : "w-[200px]"}
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

    </div>
  );
}
