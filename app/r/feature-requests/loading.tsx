import { Card, Skeleton } from "@/src/components/ui/surfaces";
import { PageHeaderSkeleton, PageSkeleton } from "@/src/components/ui/skeletons";

/** Feature requests: the heading with Suggest a feature, the tabs and search, then the list. */
export default function FeatureRequestsLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-56" actions={1} />
      <div className="flex flex-col gap-3 lg:flex-row lg:justify-between mb-4">
        <Skeleton className="h-[52px] w-full sm:w-[360px] rounded-[10px]" />
        <Skeleton className="h-11 w-full lg:w-[420px] rounded-[3px]" />
      </div>
      <Card className="divide-y divide-line">
        {Array.from({ length: 4 }, (_, row) => (
          <div key={row} className="px-4 py-4 sm:px-5 flex flex-col gap-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </Card>
    </PageSkeleton>
  );
}
