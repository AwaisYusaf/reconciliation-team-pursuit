import { redirect } from "next/navigation";

import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { loadLineItemRows } from "@/src/modules/line-items/queries";
import { getSession } from "@/src/services/auth/session";

import { LineItemsManager } from "./line-items-manager";

export const metadata = { title: "Line Items — Grant Expense Reconciliation" };

export default async function LineItemsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await loadLineItemRows(session.orgId);

  return (
    <div>
      <PageTitle className="mb-2">Line Items</PageTitle>
      <Subtext className="mb-[26px] max-w-[75ch]">
        Budget line items used across the dashboard, expenses, cover sheets, and packet.
        Order here controls their order in documents.
      </Subtext>

      <LineItemsManager rows={rows} />
    </div>
  );
}
