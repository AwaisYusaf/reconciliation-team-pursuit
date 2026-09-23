import {
  PageSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/src/components/ui/skeletons";

/** Recurring items: the heading, then the saved templates and what each one posts. */
export default function RecurringLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-52" />
      <TableSkeleton columns={5} rows={5} />
    </PageSkeleton>
  );
}
