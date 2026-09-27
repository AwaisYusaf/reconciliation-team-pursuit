/**
 * The `/a` badge pill and the shared status/complimentary/suspended row (Phase 9 §6). Not
 * `"use client"` — it gets pulled into the client bundle by whichever importer (`org-directory.tsx`,
 * the org page) is a client component, the same way `RuleBadge` in `settings-sections.tsx` does.
 */
import type { ReactNode } from "react";

import { complimentaryState } from "@/src/domain/complimentary";
import type { IsoDate } from "@/src/domain/dates";
import { formatDateShort } from "@/src/domain/dates";
import type { DirectoryOrg } from "@/src/modules/admin/directory";
import { STATUS_LABELS, UI } from "@/src/domain/strings";
import { cn } from "@/src/lib/cn";

const TONE = {
  neutral: "bg-surface text-sub border border-line",
  success: "bg-success-bg text-success",
  warning: "bg-caution/10 text-caution",
  danger: "bg-danger-bg text-danger",
} as const;

export function Badge({
  tone,
  children,
}: {
  tone: keyof typeof TONE;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-[13px] font-medium",
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<DirectoryOrg["subscriptionStatus"], keyof typeof TONE> = {
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
