import { FormSkeleton, PageSkeleton, PageHeaderSkeleton } from "@/src/components/ui/skeletons";

/** Add Expense: the heading and its explanation, then the expense form. */
export default function NewExpenseLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-56" />
      <FormSkeleton fields={8} />
    </PageSkeleton>
  );
}
