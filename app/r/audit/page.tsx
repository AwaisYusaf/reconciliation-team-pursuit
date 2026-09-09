import { redirect } from "next/navigation";

import { PageHeader } from "@/src/components/ui/surfaces";
import { expenseAuditAction } from "@/src/db/schema";
import type { ExpenseAuditActionType } from "@/src/db/schema";
import { loadOrgAuditHistory } from "@/src/modules/expenses/queries";
import { getSession } from "@/src/services/auth/session";

import { AuditTable } from "./audit-table";

export const metadata = { title: "Audit — Grant Expense Reconciliation" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; action?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  // The real boundary is server-side, same as every other admin-only screen (D-85/D-86):
  // a manager who reaches this URL directly never sees the page or its data at all.
  if (session.role !== "admin") redirect("/r");

  const { page: pageParam, action: actionParam } = await searchParams;
  // `Number.parseInt` truncates rather than accepting a fractional page ("2.33"), which
  // would otherwise reach the query as a non-integer SQL OFFSET.
  const parsedPage = Number.parseInt(pageParam ?? "", 10);
  const page = Math.max(1, Number.isFinite(parsedPage) ? parsedPage : 1);
  const actionType = expenseAuditAction.enumValues.includes(actionParam as ExpenseAuditActionType)
    ? (actionParam as ExpenseAuditActionType)
    : undefined;

  const { events, hasNextPage } = await loadOrgAuditHistory(session.orgId, { page, actionType });

  return (
    <div>
      <PageHeader
        title="Audit"
        subtext="Every expense created, edited, deleted, restored or permanently deleted, org-wide."
      />
      <AuditTable events={events} page={page} hasNextPage={hasNextPage} actionType={actionType} />
    </div>
  );
}
