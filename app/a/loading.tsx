import { PageSkeleton, TableSkeleton, TileGridSkeleton } from "@/src/components/ui/skeletons";
import { Skeleton } from "@/src/components/ui/surfaces";

/**
 * The organizations directory: the eight filter tiles, the search and filter row, the count
 * line, then the directory table.
 *
 * Eight tiles exactly, at the screen's own `grid-cols-2 lg:grid-cols-4` — unlike the counts on
 * the customer dashboard this number is fixed (four plans, two access badges, two statuses),
 * so the skeleton can state it rather than guess.
 */
export default function AdminDirectoryLoading() {
  return (
    <PageSkeleton>
      <Skeleton className="h-7 sm:h-8 lg:h-9 w-64 mb-2" />
      <Skeleton className="h-4 w-96 max-w-full mb-6" />

      <TileGridSkeleton count={8} className="grid grid-cols-2 lg:grid-cols-4 gap-3" />

      {/* The search box and the two dropdowns beside it. */}
      <div className="flex flex-wrap gap-3 mt-6">
        <Skeleton className="h-12 w-full max-w-xs rounded-[3px]" />
        <Skeleton className="h-12 w-44 rounded-[3px]" />
        <Skeleton className="h-12 w-44 rounded-[3px]" />
      </div>

      <Skeleton className="h-4 w-40 mt-6 mb-3" />

      <TableSkeleton columns={6} rows={8} />
    </PageSkeleton>
  );
}
