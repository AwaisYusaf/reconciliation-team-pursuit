import Link from "next/link";

import { buttonClassName } from "@/src/components/ui/button";
import { PLUS_FRAME_STYLE, PlusBadge } from "@/src/components/ui/plus-badge";
import { Card, SectionTitle } from "@/src/components/ui/surfaces";
import { formatDateShort, todayIso } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";

/**
 * The Month-End Packet tab's Monthly summary card (Phase 11 §7.5). Server-renderable — nothing
 * here needs client JS. `data-tour="packet-monthly-summary"` is only carried on Reconciliation +
 * AI (`card.use`): the base plan renders no target, so the packet tour's last step is simply
 * absent there, like any other dropped step.
 */
export function MonthlySummaryCard({
  card,
  monthLabel,
}: {
  card: { use: boolean; writtenAt: Date | null };
  monthLabel: string;
}) {
  return (
    <div data-tour={card.use ? "packet-monthly-summary" : undefined} className="max-w-[460px] mt-8">
      <Card style={card.use ? PLUS_FRAME_STYLE : undefined} className="p-4 sm:p-5">
        <div className="flex items-center gap-2.5 mb-2">
          <SectionTitle>{UI.summaryTitle}</SectionTitle>
          {card.use && <PlusBadge size="sm" />}
        </div>

        {!card.use ? (
          <p className="text-[15px] text-ink">{UI.summaryPlanNote}</p>
        ) : (
          <>
            <p className="text-[15px] text-ink mb-3">
              {card.writtenAt
                ? UI.summaryMetaWritten(formatDateShort(todayIso(card.writtenAt)))
                : UI.summaryNoneForMonth(monthLabel)}
            </p>
            <Link href="/r/monthly-summary" className={buttonClassName("secondary")}>
              {UI.summaryOpenLink}
            </Link>
          </>
        )}
      </Card>
    </div>
  );
}
