import type { ReactNode } from "react";

import { cn } from "@/src/lib/cn";

/**
 * A small rounded label: a status, "Your organization", "Needs attention".
 *
 * Moved here from `app/a/badges.tsx` when the customer's Feature requests screen needed the same
 * pill (PHASE-17): one definition, so the two sides can't drift. `/a`'s account badge row still
 * lives beside its screens and builds on this.
 */
const TONE = {
  neutral: "bg-surface text-sub border border-line",
  success: "bg-success-bg text-success",
  warning: "bg-caution/10 text-caution",
  danger: "bg-danger-bg text-danger",
} as const;

export type BadgeTone = keyof typeof TONE;

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
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
