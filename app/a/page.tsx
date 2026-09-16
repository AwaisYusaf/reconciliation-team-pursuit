import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { requireStaffPage } from "@/src/modules/admin/guard";

export default async function AdminPage() {
  // The layout also checks, but Next 16 layouts don't re-render on navigation, so the page
  // checks too (Phase 9, D-98).
  await requireStaffPage();

  return (
    <div>
      <PageTitle className="mb-2">Admin dashboard</PageTitle>
      <Subtext>Coming soon.</Subtext>
    </div>
  );
}
