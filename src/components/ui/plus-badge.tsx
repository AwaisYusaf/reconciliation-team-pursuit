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
 * The badge's own fill — dark, where `PLUS_GRADIENT` is light. The badge is the one place the
 * mark is a solid object rather than a tint, and the glow below only reads as a glow if the
 * thing casting it is darker than what it sits on.
 *
 * Staying in the brown family: `accent` at the lit corner falling to `accent-dark` and one
 * step past it. White bold 14px on this is roughly 14:1, where the old light caramel fill was
 * 5.2:1 — the dark pill is the more legible of the two, not a contrast trade.
 */
const PLUS_BADGE_FILL =
  "linear-gradient(145deg, var(--color-accent) 0%, var(--color-accent-dark) 55%, #2b1a10 100%)";

/**
 * The glow, painted inside the pill rather than cast around it.
 *
 * The reference for this effect sits on a dark page, where a caramel halo bleeding past the
 * edge reads as light. On this app's white cards the same halo has nothing to glow against and
 * comes out as a brown smudge with no edge — the badge stops looking like an object. Clipping
 * the glow to the pill keeps the lit-from-within look and gives the mark a hard edge again.
 */
const PLUS_BADGE_GLOW_LAYER =
  "radial-gradient(125% 150% at 50% 125%, rgba(148,96,63,0.65) 0%, rgba(148,96,63,0.18) 45%, rgba(148,96,63,0) 70%)";

/**
 * The pill's edges: a lit top line, a dark hairline ring to seat it against a white card, and a
 * 1px lift. Deliberately tight — this is the part that was overflowing before.
 */
const PLUS_BADGE_EDGE = [
  "inset 0 1px 0 rgba(255,255,255,0.20)",
  "inset 0 0 0 1px rgba(43,26,16,0.55)",
  "0 1px 2px rgba(43,26,16,0.30)",
].join(", ");

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
      style={{
        backgroundImage: `${PLUS_BADGE_GLOW_LAYER}, ${PLUS_BADGE_FILL}`,
        boxShadow: PLUS_BADGE_EDGE,
      }}
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
