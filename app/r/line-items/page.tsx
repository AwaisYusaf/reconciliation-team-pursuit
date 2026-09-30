import { PickFundingSource } from "@/src/components/app-shell/pick-funding-source";
import { TourSequenceSkip } from "@/src/components/app-shell/tour-sequence-skip";
import { PageHeader } from "@/src/components/ui/surfaces";
import { TourGuide } from "@/src/components/ui/tour";
import { db } from "@/src/db";
import { fundingTotalCents } from "@/src/domain/funding-limit";
import { pageTitle } from "@/src/domain/strings";
import { loadFundingPosition, loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadLineItemRows } from "@/src/modules/line-items/queries";
import { LINE_ITEMS_TOUR_STEPS } from "@/src/modules/tours/line-items-tour";
import { hasSeenTour } from "@/src/modules/tours/queries";
import { pageSession } from "@/src/lib/page-session";

import { LineItemsManager } from "./line-items-manager";

export const metadata = { title: pageTitle("Line Items") };

export default async function LineItemsPage() {
  const session = await pageSession();

  const { selectedId, activeSources } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );

  return (
    <div>
      {/* `PageHeader` rather than a title and a subtext of its own, which is what this screen
          had: the hand-rolled pair carried neither the shared spacing nor the clearance that
          keeps a subtext out of the floating selectors' corner, so this sentence ran underneath
          them. `loading.tsx` here already stands in with `PageHeaderSkeleton`, so the two now
          describe the same header instead of two different ones. */}
      <PageHeader
        title="Line Items"
        subtext="Budget line items used across the dashboard, expenses, cover sheets, and packet. Order here controls their order in documents."
      />

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
  const [rows, seenLineItemsTour, position] = await Promise.all([
    loadLineItemRows(orgId, fundingSourceId),
    hasSeenTour(userId, "line_items"),
    loadFundingPosition(db, orgId, fundingSourceId),
  ]);
  return (
    <>
      <TourGuide tour="line_items" steps={LINE_ITEMS_TOUR_STEPS} alreadySeen={seenLineItemsTour} />
      <LineItemsManager
        rows={rows}
        fundingSourceId={fundingSourceId}
        // Null: no contract value set, so nothing to compare the line items with (R9.6).
        contractTotalCents={position && position.contractValueCents > 0 ? fundingTotalCents(position) : null}
      />
    </>
  );
}
