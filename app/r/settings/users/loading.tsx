import {
  PageSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/src/components/ui/skeletons";

/** Users: the heading with the Back to Settings link in the corner, then the accounts table. */
export default function UsersLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-32" actions={1} />
      <TableSkeleton columns={4} rows={4} />
    </PageSkeleton>
  );
}
