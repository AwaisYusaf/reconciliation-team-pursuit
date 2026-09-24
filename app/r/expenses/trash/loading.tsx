import {
  PageSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/src/components/ui/skeletons";

/** Trash: the heading, the retention note, and the deleted expenses with their restore action. */
export default function TrashLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-32" />
      <TableSkeleton columns={5} rows={5} />
    </PageSkeleton>
  );
}
