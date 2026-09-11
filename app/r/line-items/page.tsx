import { redirect } from "next/navigation";

import { PickFundingSource } from "@/src/components/app-shell/pick-funding-source";
import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadLineItemRows } from "@/src/modules/line-items/queries";
import { getSession } from "@/src/services/auth/session";

import { LineItemsManager } from "./line-items-manager";

export const metadata = { title: "Line Items — Grant Expense Reconciliation" };

export default async function LineItemsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { selectedId, activeSources } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );

  return (
    <div>
      <PageTitle className="mb-2">Line Items</PageTitle>
      <Subtext className="mb-[26px] max-w-[75ch]">
        Budget line items used across the dashboard, expenses, cover sheets, and packet.
        Order here controls their order in documents.
      </Subtext>

      {selectedId === null ? (
        <PickFundingSource sources={activeSources} />
      ) : (
        <LineItemsManagerFor orgId={session.orgId} fundingSourceId={selectedId} />
      )}
    </div>
  );
}

async function LineItemsManagerFor({
  orgId,
  fundingSourceId,
}: {
  orgId: string;
  fundingSourceId: string;
}) {
  const rows = await loadLineItemRows(orgId, fundingSourceId);
  return <LineItemsManager rows={rows} fundingSourceId={fundingSourceId} />;
}
