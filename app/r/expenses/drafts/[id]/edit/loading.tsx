import { FormSkeleton, PageSkeleton, PageHeaderSkeleton } from "@/src/components/ui/skeletons";

/** Edit draft: the same form as a saved expense, with the two save buttons at its foot. */
export default function EditDraftLoading() {
  return (
    <PageSkeleton>
      <PageHeaderSkeleton titleWidth="w-48" />
      <FormSkeleton fields={8} />
    </PageSkeleton>
  );
}
