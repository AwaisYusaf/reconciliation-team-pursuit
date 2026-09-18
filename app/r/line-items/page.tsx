import { redirect } from "next/navigation";

import { PickFundingSource } from "@/src/components/app-shell/pick-funding-source";
import { TourSequenceSkip } from "@/src/components/app-shell/tour-sequence-skip";
import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { TourGuide } from "@/src/components/ui/tour";
import { pageTitle } from "@/src/domain/strings";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadLineItemRows } from "@/src/modules/line-items/queries";
import { LINE_ITEMS_TOUR_STEPS } from "@/src/modules/tours/line-items-tour";
import { hasSeenTour } from "@/src/modules/tours/queries";
import { getSession } from "@/src/services/auth/session";

import { LineItemsManager } from "./line-items-manager";

export const metadata = { title: pageTitle("Line Items") };

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
        <>
          {/* Nothing here for the line items tour to point at. Without this a walkthrough
              arriving on "All" stopped here and left its flag behind. */}
          <TourSequenceSkip tour="line_items" />
          <PickFundingSource sources={activeSources} />
        </>
      ) : (
        <LineItemsManagerFor
          orgId={session.orgId}
          userId={session.userId}
          fundingSourceId={selectedId}
        />
      )}
    </div>
  );
}

async function LineItemsManagerFor({
  orgId,
  userId,
  fundingSourceId,
}: {
  orgId: string;
  userId: string;
  fundingSourceId: string;
}) {
  const [rows, seenLineItemsTour] = await Promise.all([
    loadLineItemRows(orgId, fundingSourceId),
    hasSeenTour(userId, "line_items"),
  ]);
  return (
    <>
      <TourGuide tour="line_items" steps={LINE_ITEMS_TOUR_STEPS} alreadySeen={seenLineItemsTour} />
      <LineItemsManager rows={rows} fundingSourceId={fundingSourceId} />
    </>
  );
}
