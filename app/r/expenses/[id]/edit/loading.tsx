import { FormSkeleton, PageSkeleton, PageHeaderSkeleton } from "@/src/components/ui/skeletons";

/** Edit expense: the heading, the expense's name beneath it, then the same form. */
export default function EditExpenseLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-56" />
      <FormSkeleton fields={8} />
    </PageSkeleton>
  );
}
