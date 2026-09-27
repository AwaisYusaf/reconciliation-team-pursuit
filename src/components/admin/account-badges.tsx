/**
 * The `/a` status/complimentary/suspended badge row (Phase 9 §6), built on the shared `Badge`
 * (`src/components/ui/badge.tsx`). Both moved out of `app/a/badges.tsx` in PHASE-17: the pill to
 * the shared UI kit when the customer side needed it, this row beside the other `/a` components.
 */
import { Badge, type BadgeTone } from "@/src/components/ui/badge";
import { complimentaryState } from "@/src/domain/complimentary";
import type { IsoDate } from "@/src/domain/dates";
import { formatDateShort } from "@/src/domain/dates";
import type { DirectoryOrg } from "@/src/modules/admin/directory";
import { STATUS_LABELS, UI } from "@/src/domain/strings";

const STATUS_TONE: Record<DirectoryOrg["subscriptionStatus"], BadgeTone> = {
  active: "success",
  past_due: "warning",
  cancelled: "neutral",
  trial: "neutral",
};

/** The status · complimentary · suspended badge row shown on the directory and the org page. */
export function AccountBadges({ org, today }: { org: DirectoryOrg; today: IsoDate }) {
  const complimentary = complimentaryState(org, today);

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={STATUS_TONE[org.subscriptionStatus]}>{STATUS_LABELS[org.subscriptionStatus]}</Badge>
      {complimentary === "active" && org.complimentaryUntil === null && (
        <Badge tone="neutral">{UI.complimentaryLabel}</Badge>
      )}
      {complimentary === "active" && org.complimentaryUntil !== null && (
        <Badge tone="neutral">{UI.complimentaryUntil(formatDateShort(org.complimentaryUntil))}</Badge>
      )}
      {complimentary === "ended" && org.complimentaryUntil !== null && (
        <Badge tone="warning">{UI.complimentaryEnded(formatDateShort(org.complimentaryUntil))}</Badge>
      )}
      {org.suspendedAt !== null && <Badge tone="danger">{UI.suspendedLabel}</Badge>}
    </span>
  );
}
