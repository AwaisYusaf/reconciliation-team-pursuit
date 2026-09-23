import {
  PageSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/src/components/ui/skeletons";

/** Line Items: the heading and its long explanation, then the editable budget table. */
export default function LineItemsLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-44" />
      <TableSkeleton columns={5} rows={7} />
    </PageSkeleton>
  );
}
