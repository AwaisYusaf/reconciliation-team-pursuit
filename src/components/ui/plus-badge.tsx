import { PLAN_LABELS, UI } from "@/src/domain/strings";
import { cn } from "@/src/lib/cn";

/** The Plus gradient, strong: the badge itself and gradient text. Starts at `--color-plus-light`
 *  (app/globals.css) — the contrast note lives there, next to the token. */
export const PLUS_GRADIENT =
  "linear-gradient(135deg, var(--color-plus-light) 0%, var(--color-accent) 50%, var(--color-accent-dark) 100%)";

/** The Plus gradient, soft: backgrounds of Plus-only areas, pale enough for body text on top.
 *  Built from the theme tokens so it follows them. */
export const PLUS_SURFACE_GRADIENT =
  "linear-gradient(135deg, var(--color-surface) 0%, var(--color-autofill) 45%, color-mix(in srgb, var(--color-accent) 16%, var(--color-autofill)) 100%)";

/** The Plus gradient at border weight: the same caramel-to-brown direction, washed out so a
 *  1 px frame reads as a tint rather than a heavy outline (user feedback, 2026-09-17). */
const PLUS_BORDER_GRADIENT =
  "linear-gradient(135deg, color-mix(in srgb, var(--color-plus-light) 45%, transparent) 0%, color-mix(in srgb, var(--color-accent) 55%, transparent) 100%)";

/**
 * A Plus-only area: the soft gradient inside, a 1 px border painted with a light gradient.
 * CSS can't put a gradient on a `border-color` and keep rounded corners, so the border is a
 * transparent 1 px border with the gradient showing through it from a second background
 * layer clipped to the border box.
 */
export const PLUS_FRAME_STYLE: React.CSSProperties = {
  border: "1px solid transparent",
  backgroundImage: `${PLUS_SURFACE_GRADIENT}, ${PLUS_BORDER_GRADIENT}`,
  backgroundOrigin: "border-box",
  backgroundClip: "padding-box, border-box",
};

/** Style for text painted with the strong Plus gradient. The text stays dark brown end to end,
 *  so contrast holds against the soft surface. */
export const PLUS_GRADIENT_TEXT: React.CSSProperties = {
  backgroundImage: PLUS_GRADIENT,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};

/**
 * The Reconciliation + AI plan mark. The one gradient in the app: design-language.md says no
 * gradients, and this is the deliberate exception, so the AI plan reads as a product tier
 * rather than another brown control. Shared by the header and every Plus-only surface (Phase 10)
 * so the tier looks the same wherever it appears.
 */
export function PlusBadge({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <span
      title={PLAN_LABELS.reconciliation_ai}
      style={{ backgroundImage: PLUS_GRADIENT }}
      className={cn(
        // `font-sans` is explicit: without it the badge inherits whatever sits around it, so the one
        // beside a serif page title came out in Georgia while the header's stayed Arial.
        "inline-block rounded-full text-surface font-sans font-bold leading-none tracking-[0.01em] align-middle",
        size === "md" ? "px-3.5 py-1.5 text-[14px]" : "px-2 py-1 text-[12px]",
        className,
      )}
    >
      {UI.planPlusBadge}
    </span>
  );
}

/** Small four-point sparkle marking AI-read content. Decorative — always paired with text. */
export function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={cn("inline-block w-4 h-4 flex-none", className)}
      fill="currentColor"
    >
      <path d="M10 1.5c.4 3.9 2.6 6.1 6.5 6.5-3.9.4-6.1 2.6-6.5 6.5-.4-3.9-2.6-6.1-6.5-6.5 3.9-.4 6.1-2.6 6.5-6.5Z" />
      <path d="M16 12.5c.2 1.8 1.2 2.8 3 3-1.8.2-2.8 1.2-3 3-.2-1.8-1.2-2.8-3-3 1.8-.2 2.8-1.2 3-3Z" opacity=".7" />
    </svg>
  );
}
