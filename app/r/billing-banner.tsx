import Link from "next/link";

import { buttonClassName } from "@/src/components/ui/button";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { formatDateTimeUS, formatDateUS, type IsoDate } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import type { BillingBanner as Banner } from "@/src/modules/billing/plan-view-loader";

const PLAN_SECTION = "/r/settings?section=plan";

/**
 * The single billing notice under the header (Phase 16 §4.5). Each has one next step, which
 * goes to Plan & billing, where the real buttons are. Nothing renders for a healthy org.
 */
export function BillingBanner({ banner }: { banner: Banner | null }) {
  if (!banner) return null;

  if (banner.kind === "paymentFailed") {
    return (
      <DangerPanel tone="notice" className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span>{banner.isAdmin ? UI.billingPaymentFailed : UI.billingPaymentFailedManager(banner.adminNames)}</span>
        {banner.isAdmin && (
          <Link href={PLAN_SECTION} className={buttonClassName("secondary")}>
            {UI.billingPortal}
          </Link>
        )}
      </DangerPanel>
    );
  }

  const text =
    banner.kind === "upgradeWaiting"
      ? UI.billingUpgradeWaiting(formatDateTimeUS(new Date(banner.expiresAt)))
      : UI.billingCompEnding(formatDateUS(banner.until as IsoDate));

  return (
    <div
      // Same wash as the accent StatTile (`stat-tile.tsx`): white at the top edge shading into
      // `hero-wash` at the foot, so this banner reads as the same material as the emphasised
      // tile in a grid, rather than the flat `Card` surface.
      className={
        "mb-3 border border-line rounded-[6px] " +
        "bg-[linear-gradient(to_top,var(--color-hero-wash)_0%,var(--color-surface)_70%)] " +
        "px-3 py-2.5 sm:px-4 sm:py-3 flex flex-wrap items-center justify-between gap-3 text-[15px] text-ink"
      }
    >
      <span>{text}</span>
      <Link href={PLAN_SECTION} className={buttonClassName("secondary")}>
        {UI.billingSectionTitle}
      </Link>
    </div>
  );
}
