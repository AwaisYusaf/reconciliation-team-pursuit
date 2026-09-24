import { PageSkeleton, PageHeaderSkeleton } from "@/src/components/ui/skeletons";
import { Card, Skeleton } from "@/src/components/ui/surfaces";

/**
 * Monthly summary: the saved-month chips in a scrolling row, then the editor beneath them at
 * full width.
 */
export default function MonthlySummaryLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-60" subtext={false} />

      <div className="min-w-0 mb-4">
        <Skeleton className="h-5 w-36 mb-2" />
        <div className="flex gap-2 pb-1">
          {[0, 1, 2].map((chip) => (
            <Skeleton key={chip} className="shrink-0 h-[68px] w-40 rounded-[10px]" />
          ))}
        </div>
      </div>

      {/* The summary itself — a document, so this is paragraphs rather than fields. */}
      <Card className="p-4 sm:p-5 lg:p-6">
        <Skeleton className="h-6 w-48 mb-5" />
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((line) => (
            <Skeleton key={line} className={line % 4 === 3 ? "h-4 w-2/3" : "h-4 w-full"} />
          ))}
        </div>
      </Card>
    </PageSkeleton>
  );
}
