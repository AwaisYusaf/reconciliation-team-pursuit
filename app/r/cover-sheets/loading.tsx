import { CardSkeleton, PageSkeleton, PageHeaderSkeleton } from "@/src/components/ui/skeletons";
import { Skeleton } from "@/src/components/ui/surfaces";

/**
 * Cover Sheets: one section per line item, each a heading over a sheet preview.
 *
 * Three, not the real count. The number depends on the organisation's budget, and a skeleton
 * that guessed high would leave the page collapsing as the real sheets arrive.
 */
export default function CoverSheetsLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-56" />

      {[0, 1, 2].map((sheet) => (
        <div key={sheet} className="mb-8">
          <Skeleton className="h-5 w-52 mb-3" />
          <CardSkeleton heading={false} lines={6} />
        </div>
      ))}
    </PageSkeleton>
  );
}
