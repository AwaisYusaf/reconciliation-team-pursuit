import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { todayIso } from "@/src/domain/dates";
import { requireStaffPage } from "@/src/modules/admin/guard";
import { loadOrgDirectory } from "@/src/modules/admin/queries";

import { OrgDirectory } from "./org-directory";

export const metadata = { title: "Organizations — AB Solutions admin" };

export default async function AdminPage() {
  // The layout also checks, but Next 16 layouts don't re-render on navigation, so the page
  // checks too (Phase 9, D-98).
  await requireStaffPage();

  const rows = await loadOrgDirectory();
  const today = todayIso();

  return (
    <div>
      <PageTitle className="mb-2">Organizations</PageTitle>
      <Subtext className="mb-6">Every organization on the app, its plan, status and access.</Subtext>
      <OrgDirectory rows={rows} today={today} />
    </div>
  );
}
