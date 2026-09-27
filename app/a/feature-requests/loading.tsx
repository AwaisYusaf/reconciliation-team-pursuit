import { PageSkeleton, TableSkeleton } from "@/src/components/ui/skeletons";
import { Skeleton } from "@/src/components/ui/surfaces";

/** The staff feature requests list: section links, title, the three filters, the count, the table. */
export default function StaffFeatureRequestsLoading() {
  return (
    <PageSkeleton>
      <Skeleton className="h-[52px] w-full sm:w-[340px] rounded-[10px] mb-6" />
      <Skeleton className="h-7 sm:h-8 lg:h-9 w-64 mb-2" />
      <Skeleton className="h-4 w-80 max-w-full mb-6" />
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-12 w-full max-w-xs rounded-[3px]" />
        <Skeleton className="h-12 w-44 rounded-[3px]" />
        <Skeleton className="h-12 w-44 rounded-[3px]" />
      </div>
      <Skeleton className="h-4 w-40 mt-6 mb-3" />
      <TableSkeleton columns={7} rows={8} />
    </PageSkeleton>
  );
}
