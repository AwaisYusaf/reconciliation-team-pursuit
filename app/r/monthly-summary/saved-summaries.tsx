"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { reportResult } from "@/src/components/ui/toast";
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
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const current = row.month === activeMonth;
          return (
            <button
              key={row.month}
              type="button"
              aria-current={current || undefined}
              disabled={pending}
              onClick={() => choose(row.month)}
              className={`min-h-11 w-full text-left px-3.5 py-2.5 rounded-[3px] text-[15px] break-words border transition-colors disabled:cursor-not-allowed ${
                current
                  ? "bg-accent text-surface border-accent font-semibold"
                  : "bg-surface text-ink border-line hover:bg-section"
              }`}
            >
              {UI.summarySavedRow(row.monthLabel, row.date, row.edited)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
