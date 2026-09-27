import { PageSkeleton, TableSkeleton, TileGridSkeleton } from "@/src/components/ui/skeletons";
import { Card, Skeleton } from "@/src/components/ui/surfaces";

/**
 * One organization: the identity card with its detail pairs and the users table, then the
 * usage and AI-usage figure grids, then actions, feature requests and history.
 *
 * A stack of cards rather than one page-wide block, because that is what the screen is — the
 * skeleton reproduces the gaps between them so nothing slides when the real cards land.
 */
export default function AdminOrgLoading() {
  return (
    <PageSkeleton>
      <Card className="p-4 sm:p-5 lg:p-6 mb-6">
        <Skeleton className="h-7 sm:h-8 lg:h-9 w-72 max-w-full mb-4" />

        {/* The `dl` of label/value pairs, two columns from `sm`. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mb-5">
          {[0, 1, 2, 3, 4, 5].map((pair) => (
            <div key={pair} className="flex gap-3">
              <Skeleton className="h-4 w-28 shrink-0" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>

        <Skeleton className="h-5 w-24 mb-2" />
        <TableSkeleton columns={4} rows={3} />
      </Card>

      {/* Usage and AI usage: the same card, a heading over a grid of figures. */}
      {[0, 1].map((block) => (
        <Card key={block} className="p-4 sm:p-5 lg:p-6 mb-6">
          <Skeleton className="h-5 w-28 mb-3" />
          <TileGridSkeleton count={6} className="grid grid-cols-2 lg:grid-cols-3 gap-3" />
        </Card>
      ))}

      <Card className="p-4 sm:p-5 lg:p-6 mb-6">
        <Skeleton className="h-5 w-24 mb-3" />
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-12 w-40 rounded-[3px]" />
          <Skeleton className="h-12 w-40 rounded-[3px]" />
        </div>
      </Card>

      {/* Feature requests (PHASE-17): a heading over a short list. */}
      <Card className="p-4 sm:p-5 lg:p-6 mb-6">
        <Skeleton className="h-5 w-36 mb-2" />
        <div className="flex flex-col gap-2.5">
          {[0, 1].map((entry) => (
            <Skeleton key={entry} className="h-4 w-2/3" />
          ))}
        </div>
      </Card>

      <Card className="p-4 sm:p-5 lg:p-6">
        <Skeleton className="h-5 w-24 mb-2" />
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2, 3].map((entry) => (
            <Skeleton key={entry} className="h-4 w-full" />
          ))}
        </div>
      </Card>
    </PageSkeleton>
  );
}
