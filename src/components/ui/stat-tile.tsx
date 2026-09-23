import type { ReactNode } from "react";

import { cn } from "@/src/lib/cn";

/**
 * One labelled figure in a card.
 *
 * A primitive rather than a per-screen `div` because this object had already been written by
 * hand in three places — the dashboard's budget cards, the expenses list's payment-source
 * cards and the staff dashboard's filter tiles — and had drifted in all the ways that
 * predicts: a 3px radius next to the 4px `Card` sits beside it, and a `tracking-[0.04em]`
 * label where every other uppercase label in the app is 0.06em or 0.1em.
 *
 * The label's tracking matches the table column header (`Th`) at 0.06em deliberately: both
 * are the small uppercase word that names a figure, so they are the same thing seen in two
 * layouts and should not be two sizes.
 */
/**
 * `accent` is the emphasised tile — the one figure a grid exists to surface. It carries the
 * hero card's wash: white behind the label and the figure, shading into `hero-wash` at the
 * foot, so the emphasised tile and the big card beside it read as the same material.
 *
 * It used to be a dark fill with white type. Lighter is quieter, so this still wants to be used
 * once in a grid: against five flat white tiles the wash reads as emphasis, and against five of
 * itself it reads as nothing.
 */
export type StatTileTone = "default" | "danger" | "success" | "accent";

const SHELL_TONE: Record<StatTileTone, string> = {
  default: "bg-surface border border-line",
  danger: "bg-surface border border-line",
  success: "bg-surface border border-line",
  // The white stop at 70% is the card's, not a rounded-off version of it: a tile is short, so
  // that holds the wash to the bottom edge and leaves the figure on flat white.
  accent:
    "border border-line " +
    "bg-[linear-gradient(to_top,var(--color-hero-wash)_0%,var(--color-surface)_70%)]",
};

const LABEL_TONE: Record<StatTileTone, string> = {
  default: "text-sub",
  danger: "text-sub",
  success: "text-sub",
  // Ink and sub, now that the ground is light. The old `text-surface` here was white type, and
  // on this wash it would be invisible.
  accent: "text-sub",
};

const VALUE_TONE: Record<StatTileTone, string> = {
  default: "text-ink",
  danger: "text-danger",
  success: "text-success",
  accent: "text-ink",
};

const SUB_TONE: Record<StatTileTone, string> = {
  default: "text-sub",
  danger: "text-sub",
  success: "text-sub",
  accent: "text-sub",
};

export function StatTile({
  label,
  value,
  sub,
  tone = "default",
  size = "md",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Optional line beneath the figure, for a comparison or a qualifier. */
  sub?: ReactNode;
  tone?: StatTileTone;
  /**
   * `sm` for reference data rather than headline figures — contract and PO numbers, a date
   * range. At the default size "6/1/2026 to 6/30/2026" wrapped onto two lines and made its
   * tile taller than the row, which is a lot of weight for a value nobody reads as a number.
   */
  size?: "md" | "sm";
  className?: string;
}) {
  return (
    // `h-full` so a tile always fills its grid cell. Without it a row of tiles is as ragged as
    // its contents, and one wrapped value leaves its neighbours visibly short.
    <div
      className={cn(
        "h-full rounded-[10px] px-3.5 py-3 sm:px-4 sm:py-3.5",
        SHELL_TONE[tone],
        className,
      )}
    >
      <div
        className={cn("text-[11px] uppercase tracking-[0.06em] font-bold", LABEL_TONE[tone])}
      >
        {label}
      </div>
      {/*
        `break-words` and not `whitespace-nowrap`: these hold grant totals, which in this
        product genuinely reach nine figures. A tile is free to be two lines tall; it is not
        free to push a sibling tile out of the grid.
      */}
      <div
        className={cn(
          "font-bold tabular-nums mt-1 break-words",
          size === "sm" ? "text-[15px] sm:text-base" : "text-lg sm:text-xl",
          VALUE_TONE[tone],
        )}
      >
        {value}
      </div>
      {sub && (
        <div className={cn("text-[12px] mt-0.5 leading-snug", SUB_TONE[tone])}>{sub}</div>
      )}
    </div>
  );
}
