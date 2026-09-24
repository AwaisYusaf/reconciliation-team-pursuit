import type { ComponentProps } from "react";

import { cn } from "@/src/lib/cn";

/**
 * Tighter cells, for a table with enough columns that the roomy default cannot fit the
 * 1220px content cap.
 *
 * Padding and type size, not column widths: the columns here are sized by their content, so
 * taking roughly 12px off every cell's horizontal padding is what actually buys the room, and
 * it buys it from every column at once rather than squeezing one. Applied to descendants so a
 * table opts in at one place instead of threading a prop through every `Th` and `Td`.
 */
const DENSE = [
  "[&_th]:px-2.5 [&_th]:py-2.5 [&_td]:px-2.5 [&_td]:py-2.5 [&_td]:text-[15px]",
  // The headers too, and this is not cosmetic: the document columns hold only a dash or a
  // digit, so their uppercase header word IS the column's minimum width. "SUPPORTING" at
  // 13px with 0.06em tracking is wider than anything that ever appears beneath it.
  "[&_th]:text-[11px] [&_th]:tracking-[0.02em]",
].join(" ");

/**
 * Data tables, matching the design: a bordered white card that scrolls horizontally on
 * small screens, uppercase column headers over a 2px ink rule, hairline row dividers.
 *
 * `minWidth` is a FLOOR, not a cap: it can only force a scroll, never prevent one. Lowering
 * it does nothing for a table whose content is already wider, so a table that overflows is
 * fixed by making its content narrower (`dense`, and shorter cells), not by this number.
 */
export function TableCard({
  minWidth,
  dense = false,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { minWidth?: number; dense?: boolean }) {
  return (
    <div
      className={cn(
        "bg-surface border border-line rounded-[10px] overflow-x-auto",
        // The header band, set on the row rather than on each cell. A gradient per `th` would
        // restart at every column and read as stripes; on the row it runs once across the
        // whole width, which is what makes it one band. `Th` is transparent so this shows
        // through, and the sticky first cell paints the gradient's own dark start (see `Th`).
        "[&_thead_tr]:bg-[linear-gradient(90deg,var(--color-hero-from)_0%,var(--color-hero-to)_100%)]",
        // Alternating rows, very faintly, plus a hover. Both answer the same problem — losing
        // your line while reading across seven or more columns — and the stripe is the one
        // that works without a pointer, which is what a keyboard or a printout has. Kept at
        // the page colour rather than a tint of its own so it reads as banding, not as a
        // status: a row that looks coloured in a table where colour means "missing" would be
        // saying something it does not mean.
        //
        // Carried on a custom property rather than set straight on the row, because the
        // pinned first and last cells have to repeat it. Those cells must be opaque — they sit
        // over the row's other cells as it scrolls sideways — so they cannot let a translucent
        // row colour show through the way an ordinary cell does. With the colour in a variable
        // the row and its pinned cells read the same value (custom properties inherit), and
        // `color-mix` is what flattens each tint against the card so the opaque cell matches
        // the translucent row exactly. Set on the row directly they disagreed: every striped
        // or hovered row stayed white at both ends below `xl`.
        "[&_tbody_tr]:[--row-bg:var(--color-surface)]",
        "[&_tbody_tr:nth-child(even)]:[--row-bg:color-mix(in_srgb,var(--color-paper)_50%,var(--color-surface))]",
        "[&_tbody_tr:hover]:[--row-bg:color-mix(in_srgb,var(--color-section)_60%,var(--color-surface))]",
        "[&_tbody_tr]:bg-[var(--row-bg)] [&_tbody_tr]:transition-colors",
        dense && DENSE,
        className,
      )}
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

/**
 * Transparent, so the row's gradient band shows through, and white on it.
 *
 * The 2px ink rule that used to sit under the header is gone: the band already separates the
 * head from the body, and keeping both put a hard black line across the bottom of a brown bar.
 */
const HEAD_BASE =
  "text-[13px] uppercase tracking-[0.06em] text-surface font-bold px-3 sm:px-4 py-2.5 sm:py-3";

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
const STICKY_FIRST_BASE =
  "sticky left-0 z-10 xl:static xl:bg-transparent " +
  "shadow-[1px_0_0_var(--color-line)] xl:shadow-none";

/**
 * The row's own colour, so a pinned cell stripes and highlights with its row — see `TableCard`.
 *
 * The fallback matters: a pinned cell has to be opaque or the cells sliding under it show
 * through, and an undefined variable resolves to `transparent`, not to nothing.
 */
const STICKY_FIRST = `${STICKY_FIRST_BASE} bg-[var(--row-bg,var(--color-surface))]`;

/**
 * The header's pinned cell, which has to be opaque for the same reason the body's is, but
 * cannot be white or it punches a hole in the gradient band.
 *
 * `accent-dark` is the gradient's own 0% stop, and this is the leftmost cell, so a solid fill
 * of that colour is exactly what the gradient would have painted there anyway.
 */
const STICKY_FIRST_HEAD = `${STICKY_FIRST_BASE} bg-accent-dark`;

/**
 * The mirror image, for the actions column.
 *
 * Row actions live in the last column, so on anything narrower than the table they were only
 * reachable by scrolling to the far right — Edit and Delete were effectively hidden on a
 * phone or a laptop. Pinning them keeps the row's identity on one edge and what you can do
 * to it on the other. Released at `lg` with the first column, where nothing scrolls anyway.
 */
const STICKY_LAST_BASE =
  "sticky right-0 z-10 xl:static xl:bg-transparent " +
  "shadow-[-1px_0_0_var(--color-line)] xl:shadow-none";

/** The row's own colour, fallback and all, for the same reason as `STICKY_FIRST`. */
const STICKY_LAST = `${STICKY_LAST_BASE} bg-[var(--row-bg,var(--color-surface))]`;

/** The band's 100% stop, for the same reason as `STICKY_FIRST_HEAD`. */
const STICKY_LAST_HEAD = `${STICKY_LAST_BASE} bg-[var(--color-hero-to)]`;

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
        sticky && STICKY_FIRST_HEAD,
        stickyEnd && STICKY_LAST_HEAD,
        className,
      )}
      {...props}
    />
  );
}

// `py-2.5 sm:py-3`, down from `py-3 sm:py-3.5` — 4px off each row at `sm`. Trimmed rather than
// halved because this padding is shared by every table in the app, including ones whose cells
// hold wrapping text (the expenses Narrative column), where it is doing real work.
const CELL_BASE =
  "px-3 sm:px-4 py-2.5 sm:py-3 border-b border-line text-[15px] sm:text-base text-ink break-words";

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

/**
 * A body row that can carry a status tint — an over-budget source, a just-saved recurring item.
 *
 * The tint goes through `--row-bg`, not through a `bg-*` class on the row, and that is the
 * whole point of this component. `TableCard` paints every body row with
 * `[&_tbody_tr]:bg-[var(--row-bg)]`, a selector carrying one class and two element names; a
 * `bg-danger-bg` written straight on the `<tr>` carries one class and loses the cascade to it.
 * The tint simply did not paint, and because the pinned first cell reads `--row-bg` separately
 * it *did* honour a class written on itself — so an over-budget row rendered as a red name cell
 * beside untinted figures, the inverse of what was intended.
 *
 * Set as an inline custom property rather than a utility class because inline styles are
 * outside the specificity contest entirely: no arrangement of classes on the row can beat a
 * descendant selector on the card, so anything class-based here would be re-litigating the bug.
 * The pinned cells pick the value up for free, since they already fall back through the same
 * variable, which is what makes the row tint edge to edge.
 *
 * The trade: a tinted row no longer lightens on hover, because the inline value also outranks
 * the hover rule. Deliberate — the tint means something and the hover is decoration, so the
 * one that carries meaning is the one that survives.
 */
const ROW_TONES = {
  danger: "var(--color-danger-bg)",
  success: "var(--color-success-bg)",
} as const;

export function Tr({
  tone,
  style,
  ...props
}: ComponentProps<"tr"> & { tone?: keyof typeof ROW_TONES }) {
  return (
    <tr
      style={
        tone ? ({ ...style, "--row-bg": ROW_TONES[tone] } as React.CSSProperties) : style
      }
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
