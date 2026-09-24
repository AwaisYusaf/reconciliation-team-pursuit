import { PageSkeleton } from "@/src/components/ui/skeletons";
import { Card, Skeleton } from "@/src/components/ui/surfaces";

/**
 * Settings: the section list on its light track at the side, the open section's panel beside
 * it. Six rows in the list — a manager sees five, because Users is admin-only, but the list is
 * a fixed height either way and one row of difference is not worth reading the session here.
 */
export default function SettingsLoading() {
  return (
    <PageSkeleton>
      <Skeleton className="h-7 sm:h-8 w-40 mb-6" />

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="w-full lg:w-[220px] lg:flex-none bg-section border-2 border-line rounded-[10px] p-2">
          <div className="flex flex-col gap-0.5">
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div key={row} className="flex items-center gap-2.5 px-3.5 py-2.5">
                <Skeleton className="w-[18px] h-[18px] shrink-0 rounded-[4px]" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-0 w-full">
          <Card className="p-4 sm:p-6">
            <Skeleton className="h-6 w-44 mb-5" />
            <div className="grid gap-5 lg:grid-cols-2">
              {[0, 1].map((field) => (
                <div key={field}>
                  <Skeleton className="h-3.5 w-36 mb-2" />
                  <Skeleton className="h-12 w-full rounded-[3px]" />
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-6">
              <Skeleton className="h-12 w-24 rounded-[3px]" />
            </div>
          </Card>
        </div>
      </div>
    </PageSkeleton>
  );
}
