import type { ComponentProps } from "react";

import { cn } from "@/src/lib/cn";

/**
 * Buttons, matching the approved design exactly:
 * primary = brown fill, secondary = brown outline, quiet = underlined text link.
 * Minimum target heights (48px / 44px) come from the design system's touch rules.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet";

const BASE = "rounded-[3px] font-sans transition-colors disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "min-h-12 px-[22px] bg-accent text-surface font-bold text-base hover:bg-accent-dark " +
    "disabled:bg-disabled disabled:text-disabled-ink disabled:hover:bg-disabled",
  secondary:
    "min-h-12 px-[18px] bg-surface text-accent font-bold text-base border border-accent " +
    "hover:bg-section disabled:bg-disabled disabled:text-disabled-ink disabled:border-transparent",
  quiet:
    "min-h-11 py-3 text-[15px] text-accent underline bg-transparent border-none hover:text-accent-dark " +
    "disabled:text-disabled-ink disabled:no-underline",
};

export function Button({
  variant = "primary",
  fullWidth = false,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; fullWidth?: boolean }) {
  return (
    <button
      type={type}
      className={cn(BASE, VARIANTS[variant], fullWidth && "w-full", className)}
      {...props}
    />
  );
}

/**
 * The button styles applied to a link, for navigation that looks like an action.
 * Use with `next/link` — a `<button>` may not wrap an anchor.
 */
export function buttonClassName(
  variant: ButtonVariant = "primary",
  className?: string,
): string {
  return cn(BASE, VARIANTS[variant], "inline-flex items-center justify-center", className);
}
