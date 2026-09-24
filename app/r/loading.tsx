import {
  CardSkeleton,
  PageSkeleton,
  TableSkeleton,
  TileGridSkeleton,
} from "@/src/components/ui/skeletons";
import { Card, Skeleton } from "@/src/components/ui/surfaces";

/**
 * The dashboard, and the fallback for any `/r` segment that does not declare its own.
 *
 * The dashboard's shape: the month line above the greeting, then the hero card and its chart
 * beside the six tiles, then the actions, then recent expenses and the line-item table. One
 * funding source's worth — with "All" selected the real screen repeats this per source, and a
 * skeleton that guessed at the count would be wrong more often than right.
 */
export default function DashboardLoading() {
  return (
    <PageSkeleton>
      {/* Subtext first, then the title: the month line reads before the greeting. */}
      <Skeleton className="h-4 w-44 mb-1" />
      <Skeleton className="h-7 sm:h-8 w-72 mb-5 sm:mb-6" />

      <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr] mb-3">
        <Card className="p-4 sm:p-5 flex flex-col">
          <div className="flex items-start justify-between gap-3 mb-3">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-7 w-32 rounded-full" />
          </div>
          <Skeleton className="h-9 sm:h-10 w-56 mb-2" />
          <Skeleton className="h-3.5 w-64" />

          {/* The twelve-month chart: a row of bars at the real chart's height, with the axis
              labels under them. Uneven by design — a row of equal bars reads as a rendered
              chart that happens to be flat, not as one that has not arrived. */}
          <div className="mt-auto pt-4">
            <div className="flex items-center justify-between mb-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-32" />
            </div>
            <div className="flex items-end gap-1 sm:gap-1.5 h-[92px] sm:h-[108px]">
              {[45, 70, 30, 85, 55, 95, 40, 65, 25, 75, 50, 60].map((height, month) => (
                <div key={month} className="flex-1 flex justify-center h-full items-end">
                  <Skeleton
                    className="w-full max-w-[16px] rounded-full"
                    style={{ height: `${height}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-1 sm:gap-1.5 mt-2">
              {Array.from({ length: 12 }, (_, month) => (
                <Skeleton key={month} className="flex-1 h-3" />
              ))}
            </div>
          </div>
        </Card>

        <TileGridSkeleton count={6} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Skeleton className="h-12 w-36 rounded-[3px]" />
        <Skeleton className="h-12 w-52 rounded-[3px]" />
      </div>

      <CardSkeleton lines={5} className="mb-3" />
      <TableSkeleton columns={6} rows={6} />
    </PageSkeleton>
  );
}
