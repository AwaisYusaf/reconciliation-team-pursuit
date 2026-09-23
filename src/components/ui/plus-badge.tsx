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
 * The badge's own fill: flat, and the darkest brown in the palette's direction.
 *
 * Flat on purpose. The glow below lives on the pill's edges, and an edge glow only reads as
 * one if the middle it fades into is even — a ramp across the fill competes with it and the
 * whole thing turns to mush. White bold 14px on this is roughly 15:1.
 */
const PLUS_BADGE_FILL = "#241509";

/**
 * The glow: along the bottom and up both sides, never through the middle.
 *
 * Three radials, each with its centre placed *outside* the pill — below it, and past each
 * end. That is what keeps the centre clear: a gradient centred on the badge lights the middle
 * brightest, which is the opposite of a rim. Pushed out, only their falloff lands inside, and
 * it lands on the edge nearest each one.
 *
 * Painted inside the pill rather than cast around it. On this app's white cards a halo bleeding
 * past the edge has nothing to glow against and comes out as a brown smudge with no edge; the
 * badge stops looking like an object. Clipping it keeps the lit-from-within look and the pill
 * keeps a hard outline.
 */
const PLUS_BADGE_GLOW_LAYER = [
  // Bottom, the brightest of the three and the one that reads as the light source.
  "radial-gradient(80% 120% at 50% 122%, rgba(160,108,72,0.95) 0%, rgba(160,108,72,0.38) 38%, rgba(160,108,72,0) 68%)",
  // The two ends, dimmer, so the rim carries round the corners instead of stopping.
  "radial-gradient(38% 150% at -6% 55%, rgba(160,108,72,0.62) 0%, rgba(160,108,72,0) 70%)",
  "radial-gradient(38% 150% at 106% 55%, rgba(160,108,72,0.62) 0%, rgba(160,108,72,0) 70%)",
].join(", ");

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
        // The flat fill goes on `background-color`, the glow on `background-image`. They were
        // one `background-image` list with the colour on the end, which is invalid — a colour
        // is not an image — so the browser dropped the whole declaration and the badge came
        // out as white text on nothing.
        backgroundColor: PLUS_BADGE_FILL,
        backgroundImage: PLUS_BADGE_GLOW_LAYER,
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
