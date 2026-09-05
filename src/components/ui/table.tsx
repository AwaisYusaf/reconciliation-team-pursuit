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
  "text-[13px] uppercase tracking-[0.06em] text-sub font-bold px-3 sm:px-4 py-3 sm:py-3.5 border-b-2 border-ink";

/**
 * Keep the identifying column visible while the rest of a wide table scrolls.
 *
 * Scrolling sideways otherwise takes the row's identity away with everything else, leaving a
 * row of figures belonging to nothing.
 *
 * Released at `xl`, not `lg`. The design language caps content at 1220px, so the widest table
 * (expenses, with its Narrative column) needs about 1160 and only genuinely fits once the
 * viewport reaches the `xl` (1280px) breakpoint, where that 1220px cap is no longer squeezed
 * by a narrower viewport; releasing at 1024 dropped the pin at a width where the table still
 * overflowed, which is the width a laptop actually is.
 */
const STICKY_FIRST =
  "sticky left-0 z-10 bg-surface xl:static xl:bg-transparent " +
  "shadow-[1px_0_0_var(--color-line)] xl:shadow-none";

/**
 * The mirror image, for the actions column.
 *
 * Row actions live in the last column, so on anything narrower than the table they were only
 * reachable by scrolling to the far right — Edit and Delete were effectively hidden on a
 * phone or a laptop. Pinning them keeps the row's identity on one edge and what you can do
 * to it on the other. Released at `lg` with the first column, where nothing scrolls anyway.
 */
const STICKY_LAST =
  "sticky right-0 z-10 bg-surface xl:static xl:bg-transparent " +
  "shadow-[-1px_0_0_var(--color-line)] xl:shadow-none";

export function Th({
  align = "left",
  sticky = false,
  stickyEnd = false,
  className,
  ...props
}: ComponentProps<"th"> & {
  align?: "left" | "right";
  sticky?: boolean;
  stickyEnd?: boolean;
}) {
  return (
    <th
      scope="col"
      className={cn(
        HEAD_BASE,
        align === "right" ? "text-right" : "text-left",
        sticky && STICKY_FIRST,
        stickyEnd && STICKY_LAST,
        className,
      )}
      {...props}
    />
  );
}

const CELL_BASE =
  "px-3 sm:px-4 py-3 sm:py-3.5 border-b border-line text-[15px] sm:text-base text-ink";

export function Td({
  align = "left",
  numeric = false,
  bold = false,
  sticky = false,
  stickyEnd = false,
  className,
  ...props
}: ComponentProps<"td"> & {
  align?: "left" | "right";
  numeric?: boolean;
  bold?: boolean;
  /** Pins this cell while the rest of a wide table scrolls. Use on the first column only. */
  sticky?: boolean;
  /** Pins this cell to the right edge. Use on the last column only. */
  stickyEnd?: boolean;
}) {
  return (
    <td
      className={cn(
        CELL_BASE,
        align === "right" ? "text-right" : "text-left",
        numeric && "tabular-nums whitespace-nowrap",
        bold && "font-bold",
        sticky && STICKY_FIRST,
        stickyEnd && STICKY_LAST,
        className,
      )}
      {...props}
    />
  );
}

/** Full-width section divider row, e.g. BASE on the summary. */
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
