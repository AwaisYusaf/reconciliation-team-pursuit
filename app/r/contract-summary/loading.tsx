import {
  PageSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
  TileGridSkeleton,
} from "@/src/components/ui/skeletons";

/**
 * Contract Summary: the contract's reference figures across the top, then the position table.
 *
 * Five tiles across at `xl`, matching the real grid's breakpoints exactly — this row changes
 * column count four times between phone and desktop, and a skeleton on different breakpoints
 * from the thing it precedes reflows the whole page on swap.
 */
export default function ContractSummaryLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-64" />
      <TileGridSkeleton
        count={5}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 mb-[26px]"
      />
      <TableSkeleton columns={6} rows={7} />
    </PageSkeleton>
  );
}
