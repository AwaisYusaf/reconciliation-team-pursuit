import { ACTION_CLEARANCE, Card, Skeleton } from "@/src/components/ui/surfaces";
import { cn } from "@/src/lib/cn";

/**
 * The shapes the app's screens are built from, as skeletons.
 *
 * Each `loading.tsx` composes these into the layout of its own screen, rather than every screen
 * sharing one grey page. The parts live here for the reason the real components do: the spacing
 * has to match what replaces it, or the page jumps when the content arrives, and fifteen files
 * repeating `mb-6 sm:mb-[26px]` by hand would drift from `PageHeader` the first time it changed.
 *
 * Every piece here is built from `Skeleton`, which is `aria-hidden`. The announcement belongs on
 * the page — `PageSkeleton` does it once for the whole screen.
 */

/**
 * The wrapper each `loading.tsx` returns. Announces the wait once, for the whole screen.
 *
 * `role="status"` with one `sr-only` message, rather than a label per block: a screen reader
 * hearing "loading" forty times is worse than hearing nothing.
 */
export function PageSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

/**
 * Stands in for `PageHeader` — and carries its exact spacing, including `ACTION_CLEARANCE` on
 * the actions, so the title does not shift downward when the real header renders.
 */
export function PageHeaderSkeleton({
  subtext = true,
  actions = 0,
  titleWidth = "w-64",
}: {
  subtext?: boolean;
  /** How many buttons sit in the header's action corner. */
  actions?: number;
  titleWidth?: string;
}) {
  return (
    <div className="flex flex-col gap-3 mb-6 sm:mb-[26px] lg:flex-row lg:items-start lg:justify-between lg:gap-6">
      <div className="min-w-0">
        <Skeleton className={cn("h-7 sm:h-8 mb-1.5", titleWidth)} />
        {subtext && <Skeleton className="h-4 w-48" />}
      </div>
      {actions > 0 && (
        <div className={cn("flex flex-wrap items-center gap-3 shrink-0", ACTION_CLEARANCE)}>
          {Array.from({ length: actions }, (_, index) => (
            <Skeleton key={index} className="h-11 w-40 rounded-[3px]" />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A table: the header row, then body rows.
 *
 * The first column is wider than the rest because in every table in this app it is the name —
 * the line item, the vendor, the expense — and the columns after it are money and dates.
 */
export function TableSkeleton({
  columns = 5,
  rows = 6,
  className,
}: {
  columns?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="border-b border-line bg-section/60 px-4 py-3 flex gap-4">
        {Array.from({ length: columns }, (_, column) => (
          <Skeleton key={column} className={cn("h-3", column === 0 ? "flex-[2]" : "flex-1")} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className={cn("px-4 py-3.5 flex gap-4 items-center", row > 0 && "border-t border-line")}
        >
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className={cn("h-4", column === 0 ? "flex-[2]" : "flex-1")} />
          ))}
        </div>
      ))}
    </Card>
  );
}

/** A grid of `StatTile`s, at the tile's own padding and radius. */
export function TileGridSkeleton({
  count = 6,
  className = "grid grid-cols-2 gap-3 content-start",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, tile) => (
        <div key={tile} className="bg-surface border border-line rounded-[10px] px-3.5 py-3 sm:px-4 sm:py-3.5">
          <Skeleton className="h-3 w-20 mb-2.5" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * A form inside a card: labelled fields in a two-column grid, then the save row.
 *
 * `fields` counts the inputs, not the rows — the grid wraps them two at a time, the way the
 * real forms do.
 */
export function FormSkeleton({ fields = 6, className }: { fields?: number; className?: string }) {
  return (
    <Card className={cn("p-4 sm:p-6", className)}>
      <div className="grid gap-5 sm:grid-cols-2">
        {Array.from({ length: fields }, (_, field) => (
          <div key={field}>
            <Skeleton className="h-3.5 w-28 mb-2" />
            <Skeleton className="h-12 w-full rounded-[3px]" />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <Skeleton className="h-12 w-32 rounded-[3px]" />
      </div>
    </Card>
  );
}

/** A card with a heading and a few lines — the generic panel, for side columns and notes. */
export function CardSkeleton({
  lines = 3,
  heading = true,
  className,
}: {
  lines?: number;
  heading?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      {heading && <Skeleton className="h-5 w-40 mb-4" />}
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: lines }, (_, line) => (
          <Skeleton key={line} className={cn("h-4", line === lines - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    </Card>
  );
}
