"use client";

import type { ReactNode } from "react";

import { cn } from "@/src/lib/cn";

/**
 * On/off switch — extracted from the "Show archived" control in `settings-sections.tsx`
 * (Phase 10, D-105) so it has one implementation instead of one per screen. `role="switch"`
 * with `aria-checked` is what makes a screen reader announce it as on/off; being a real
 * `<button>`, Space and Enter work without extra key handling.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  children,
  describedBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center gap-2.5 min-h-11 text-[15px] rounded-[3px]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        disabled ? "text-disabled-ink cursor-not-allowed" : "text-ink",
      )}
    >
      <span>{children}</span>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-block h-5 w-9 rounded-full transition-colors",
          // Disabled still shows on/off by colour, not only by knob position — a manager reads
          // this switch without being able to change it.
          disabled ? (checked ? "bg-disabled-ink" : "bg-disabled") : checked ? "bg-accent" : "bg-line",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}
