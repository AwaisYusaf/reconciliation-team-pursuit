"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

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
      <h2 className="font-serif text-lg font-bold text-ink mb-3">{UI.summarySavedHeading}</h2>
      {/* One card, rows divided by rules; the open month is marked like the active nav tab — a
          brown rule, not a solid brown block. */}
      <div className="bg-surface border border-line rounded-[4px] divide-y divide-line overflow-hidden">
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
                "block min-h-11 w-full text-left px-4 py-3 border-l-[3px] transition-colors disabled:cursor-not-allowed",
                current ? "border-l-accent bg-section" : "border-l-transparent hover:bg-paper",
              )}
            >
              <span className="block text-[15px] font-semibold text-ink">{row.monthLabel}</span>
              <span className="block text-sm text-sub mt-0.5">{UI.summarySavedRowDate(row.date, row.edited)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
