import type { ComponentProps } from "react";

import { GRADIENT_TEXT } from "@/src/components/ui/surfaces";
import { cn } from "@/src/lib/cn";

/**
 * Buttons, matching the approved design exactly:
 * primary = brown fill, secondary = brown outline, quiet = underlined text link.
 * Minimum target heights (48px / 44px) come from the design system's touch rules.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet";

// `active:scale-[0.99]` is the whole press: a 1% squeeze for as long as the pointer is down.
// It animates `transform`, so it composites rather than laying anything out, and a disabled
// button never receives `:active` so it needs no exclusion of its own.
const BASE =
  "rounded-[3px] font-sans transition-[color,background-color,border-color,transform] " +
  "duration-150 active:scale-[0.99] disabled:cursor-not-allowed";

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

/**
 * The white button's label, painted with the app's gradient.
 *
 * It has to be a span inside the button, never a class on the button: `bg-clip-text` clips
 * every background the element has, so on the button itself it would clip away the white fill
 * and leave a hollow outline.
 *
 * Skipped while disabled. A disabled button's whole job is to look unavailable, and the
 * gradient would paint its label in full-strength brown over the grey fill.
 */
export function ButtonLabel({
  children,
  disabled = false,
}: {
  children: React.ReactNode;
  /** Pass the button's own disabled state — a `<button>` styled by `buttonClassName` carries
   *  it, so the label cannot read it from anywhere else. */
  disabled?: boolean;
}) {
  if (disabled) return <>{children}</>;
  return <span className={GRADIENT_TEXT}>{children}</span>;
}

/**
 * True when a label is nothing but text, so painting it with the gradient can lose nothing.
 *
 * An array counts when every part of it is text, which is what an interpolated label like
 * `Save {count} items` compiles to. Checking only for `typeof children === "string"` made that
 * button render flat beside an identical neighbour whose label happened to be one literal —
 * the same control, styled two ways, decided by whether the words contained a variable.
 *
 * `null`, `undefined` and `false` are ignored rather than disqualifying: they are what a
 * `{condition && "…"}` inside a label leaves behind, and they draw nothing.
 */
function isTextOnly(children: React.ReactNode): boolean {
  if (Array.isArray(children)) {
    return children.some((child) => isText(child)) && children.every(isTextOrEmpty);
  }
  return isText(children);
}

function isText(node: React.ReactNode): boolean {
  return typeof node === "string" || typeof node === "number";
}

function isTextOrEmpty(node: React.ReactNode): boolean {
  return isText(node) || node === null || node === undefined || typeof node === "boolean";
}

export function Button({
  variant = "primary",
  fullWidth = false,
  className,
  type = "button",
  children,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; fullWidth?: boolean }) {
  // Only the white button. `primary` is white type on a dark fill, where a gradient can only
  // go darker — contrast spent on decoration — and `quiet` draws its underline in
  // `currentColor`, which the gradient sets to transparent, so its underline would vanish.
  //
  // Text-only labels, too. The gradient span sets `color: transparent`, and several of these
  // buttons hold an icon beside their text — an SVG drawn in `currentColor` inside that span
  // disappears completely. Text is the case where there is nothing to lose.
  const gradientLabel = variant === "secondary" && !props.disabled && isTextOnly(children);
  return (
    <button
      type={type}
      className={cn(BASE, VARIANTS[variant], fullWidth && "w-full", className)}
      {...props}
    >
      {gradientLabel ? <ButtonLabel>{children}</ButtonLabel> : children}
    </button>
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
