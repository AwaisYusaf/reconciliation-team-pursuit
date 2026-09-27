import { CardSkeleton, PageSkeleton } from "@/src/components/ui/skeletons";
import { Skeleton } from "@/src/components/ui/surfaces";

/** One feature request in /a: back link, the request, status, votes, replies. */
export default function StaffFeatureRequestLoading() {
  return (
    <PageSkeleton>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-5 w-40" />
        <CardSkeleton lines={5} />
        <CardSkeleton lines={2} />
        <CardSkeleton lines={2} />
        <CardSkeleton lines={3} />
      </div>
    </PageSkeleton>
  );
}
