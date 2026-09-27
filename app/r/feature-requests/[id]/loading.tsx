import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from "@/src/components/ui/skeletons";
import { Skeleton } from "@/src/components/ui/surfaces";

/** One feature request: the back link, its title, the details card and the replies. */
export default function FeatureRequestLoading() {
  return (
    <PageSkeleton>
      <Skeleton className="h-5 w-48 mb-5" />
      <PageHeaderSkeleton titleWidth="w-80" actions={1} />
      <div className="flex flex-col gap-5">
        <CardSkeleton heading={false} lines={4} />
        <CardSkeleton lines={3} />
      </div>
    </PageSkeleton>
  );
}
