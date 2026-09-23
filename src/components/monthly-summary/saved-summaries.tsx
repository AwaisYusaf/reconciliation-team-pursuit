"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { GRADIENT_TEXT } from "@/src/components/ui/surfaces";
import { reportResult } from "@/src/components/ui/toast";
import { cn } from "@/src/lib/cn";
import { UI } from "@/src/domain/strings";
import { setActiveMonthAction } from "@/src/modules/auth/actions";

export type SavedSummaryRow = {
  month: string;
  monthLabel: string;
  /** Pre-formatted server-side (`formatDateShort`) — no `Date` crosses the server/client
   *  boundary (P14). */
  date: string;
  edited: boolean;
};

/**
 * The saved-months list (§7.1), newest first (already the order `rows` arrives in). Clicking a
 * row switches the active month everywhere, same as `MonthSelector` — `setActiveMonthAction`
 * then `router.refresh()`.
 */
export function SavedSummaries({
  rows,
  activeMonth,
}: {
  rows: readonly SavedSummaryRow[];
  activeMonth: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) return null;

  function choose(month: string) {
    startTransition(async () => {
      const result = await setActiveMonthAction(month);
      if (reportResult(result)) router.refresh();
    });
  }

  return (
    <div className="min-w-0">
      <h2 className="font-serif text-base font-bold text-ink mb-2">{UI.summarySavedHeading}</h2>
      {/*
        A row of months, not a column beside the editor.

        As a 280px sidebar it pushed the summary itself into two thirds of the screen — and
        the summary is a document people read and edit, so it wants the width far more than a
        list of three months does. Across the top the months are still one click away, the
        editor gets the whole column, and the list grows sideways rather than stretching the
        section taller.

        It scrolls rather than wrapping: a year of saved months would otherwise become four
        ragged rows of chips above the thing you came to read.
      */}
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {rows.map((row) => {
          const current = row.month === activeMonth;
          return (
            <button
              key={row.month}
              type="button"
              aria-current={current || undefined}
              disabled={pending}
              onClick={() => choose(row.month)}
              className={cn(
                "shrink-0 min-h-11 text-left px-4 py-2.5 rounded-[10px] border transition-colors disabled:cursor-not-allowed",
                current
                  ? // The selected month gets the card's brown wash and a lit top edge, the
                    // same treatment as the dashboard's hero card — light enough that the
                    // month's own ink and sub text keep their contrast over it.
                    "border-accent bg-[linear-gradient(to_top,var(--color-hero-wash)_0%,var(--color-surface)_75%)] " +
                    "shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
                  : "border-line bg-surface hover:bg-section",
              )}
            >
              <span
                className={cn(
                  "block text-[15px] font-semibold whitespace-nowrap",
                  // Gradient only on the selected month: on the unselected chips beside it the
                  // ramp would read as decoration on every one and mark nothing.
                  current ? GRADIENT_TEXT : "text-ink",
                )}
              >
                {row.monthLabel}
              </span>
              <span className="block text-[13px] text-sub mt-0.5 whitespace-nowrap">
                {UI.summarySavedRowDate(row.date, row.edited)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
