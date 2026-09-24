import {
  PageSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/src/components/ui/skeletons";
import { Skeleton } from "@/src/components/ui/surfaces";

/** Vendor library: the heading, the search box above the table, and the paged vendor list. */
export default function VendorsLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-56" actions={1} />
      <Skeleton className="h-12 w-full max-w-sm rounded-[3px] mb-4" />
      <TableSkeleton columns={4} rows={8} />
    </PageSkeleton>
  );
}
