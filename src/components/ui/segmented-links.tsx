import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/src/lib/cn";

/**
 * A row of links drawn as one control, the current one a raised pill: the customer's
 * Feature requests tabs and the `/a` sections (PHASE-17). Links rather than buttons, so the
 * choice lives in the URL and Back works. The pill is the Settings sidebar's selected item,
 * lying flat.
 */
export function SegmentedLinks({
  label,
  items,
  className,
}: {
  /** Names the group for a screen reader. */
  label: string;
  items: Array<{ href: string; label: ReactNode; active: boolean }>;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn("flex gap-1 bg-section border-2 border-line rounded-[10px] p-1 w-full sm:w-fit", className)}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "flex-1 sm:flex-none min-h-11 px-4 inline-flex items-center justify-center gap-2 rounded-[8px] text-[15px] font-medium no-underline transition-colors",
            item.active
              ? "text-white bg-[linear-gradient(145deg,var(--color-accent)_0%,var(--color-accent-dark)_100%)] " +
                  "shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_2px_rgba(43,26,16,0.25)]"
              : "text-sub hover:bg-surface/60 hover:text-ink",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
