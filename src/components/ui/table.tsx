import type { ComponentProps } from "react";

import { cn } from "@/src/lib/cn";

/**
 * Data tables, matching the design: a bordered white card that scrolls horizontally on
 * small screens, uppercase column headers over a 2px ink rule, hairline row dividers.
 */
export function TableCard({
  minWidth,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { minWidth?: number }) {
  return (
    <div
      className={cn("bg-surface border border-line rounded-[4px] overflow-x-auto", className)}
      {...props}
    >
      <table
        className="w-full border-collapse bg-surface"
        style={minWidth ? { minWidth: `${minWidth}px` } : undefined}
      >
        {children}
      </table>
    </div>
  );
}

const HEAD_BASE =
  "text-[13px] uppercase tracking-[0.06em] text-sub font-bold px-4 py-3.5 border-b-2 border-ink";

export function Th({
  align = "left",
  className,
  ...props
}: ComponentProps<"th"> & { align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={cn(HEAD_BASE, align === "right" ? "text-right" : "text-left", className)}
      {...props}
    />
  );
}

const CELL_BASE = "px-4 py-3.5 border-b border-line text-base text-ink";

export function Td({
  align = "left",
  numeric = false,
  bold = false,
  className,
  ...props
}: ComponentProps<"td"> & { align?: "left" | "right"; numeric?: boolean; bold?: boolean }) {
  return (
    <td
      className={cn(
        CELL_BASE,
        align === "right" ? "text-right" : "text-left",
        numeric && "tabular-nums whitespace-nowrap",
        bold && "font-bold",
        className,
      )}
      {...props}
    />
  );
}

/** Full-width section divider row, e.g. BASE / PERFORMANCE GRANT 1 on the summary. */
export function SectionRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="bg-section px-4 py-3 border-b border-line text-[13px] font-bold uppercase tracking-[0.08em] text-ink"
      >
        {children}
      </td>
    </tr>
  );
}
