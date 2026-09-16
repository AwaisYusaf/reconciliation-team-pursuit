import { requireStaffPage } from "@/src/modules/admin/guard";

/**
 * Admin scaffold. `requireStaffPage()` is the real boundary — `/a` is for AB Solutions staff
 * accounts only. Customers, including an organisation's own admin, are refused: every org's
 * creator is an admin, so the old `session.role !== "admin"` check let them in (Phase 9, D-98).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireStaffPage();

  return <>{children}</>;
}
