import {
  PageSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/src/components/ui/skeletons";

/** Expenses this month: the heading, the drafts and Trash buttons in the corner, the table. */
export default function ExpensesLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-72" actions={2} />
      <TableSkeleton columns={7} rows={8} />
    </PageSkeleton>
  );
}
