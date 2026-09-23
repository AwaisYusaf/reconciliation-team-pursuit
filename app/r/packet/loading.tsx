import {
  CardSkeleton,
  PageSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/src/components/ui/skeletons";
import { Card, Skeleton } from "@/src/components/ui/surfaces";

/**
 * Month-End Packet: the line-item table on the left, the download and lock controls on the
 * right, at the real screen's 2fr/1fr split and `items-start` alignment.
 */
export default function PacketLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-64" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start">
        <TableSkeleton columns={4} rows={7} />

        <div className="flex flex-col gap-3">
          {/* The download and share buttons, stacked, then the lock panel below them. */}
          <Card className="p-4 sm:p-5">
            <Skeleton className="h-5 w-36 mb-4" />
            <div className="flex flex-col gap-3">
              <Skeleton className="h-12 w-full rounded-[3px]" />
              <Skeleton className="h-12 w-full rounded-[3px]" />
              <Skeleton className="h-12 w-full rounded-[3px]" />
            </div>
          </Card>
          <CardSkeleton lines={2} />
        </div>
      </div>
    </PageSkeleton>
  );
}
