import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/src/lib/cn";

/**
 * The shared type and spacing scale — see docs/04-engineering/review-2026-08-17-responsive.md.
 *
 * Every heading in the application comes from one of these primitives so a level has exactly
 * one definition. Sizes were written as literals at each call site before, which is how three
 * screens ended up with a non-bold h2 and why "make h2 18px on phones" would otherwise mean
 * editing every h2 by hand.
 *
 * Breakpoints: phone below 640px, tablet 640–1023px, desktop 1024px and up. Tailwind's `sm:`
 * and `lg:` mark those two boundaries, so a component reads as "phone value, then sm:, then
 * lg:" throughout.
 */

/**
 * The standard responsive padding for a panel.
 *
 * Exported as a string rather than baked into `Card` because `cn` joins classes without
 * merging them (by design — components compose fixed variants rather than override
 * utilities), so a default here would collide with the callers that set their own. Every
 * caller opts in explicitly, and they all point at this one definition.
 */
export const CARD_PADDING = "p-4 sm:p-5 lg:p-6";

/**
 * Top clearance for a screen's own top-right controls.
 *
 * The app layout parks the month and funding-source selectors in the content column's
 * top-right corner from `lg`, out of the flow so they sit level with the page title. Anything
 * else a screen puts in that corner has to start below them or it renders underneath and
 * cannot be clicked — which is exactly what happened to the Expenses screen's Trash button.
 *
 * 44px: the selector pill is 36px tall and the layout offsets it 16px from the top of the
 * content column, so this clears it with a little air. Exported rather than repeated, because
 * every screen with corner controls needs the same number and they must move together if the
 * selectors ever change height.
 */
export const ACTION_CLEARANCE = "lg:pt-11";

/**
 * One grey block standing in for content that has not arrived yet.
 *
 * Size it with `className` — `h-4 w-40` for a line of text, `h-24` for a card's body. It never
 * sets its own size, because a skeleton is only useful when it is the shape of the thing it is
 * standing in for.
 *
 * `motion-safe:` on the pulse, not a bare `animate-pulse`: a screenful of blocks breathing in
 * unison is exactly the kind of motion `prefers-reduced-motion` exists to turn off, and the
 * grey blocks still read as "not loaded yet" when they hold still.
 *
 * Marked `aria-hidden`, so announce the wait once on the container instead — see the page
 * skeletons in `loading.tsx`. Twelve blocks each announcing themselves is noise, not help.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("bg-line/50 rounded-[6px] motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

/**
 * White panel with the paper-stock border. The app's default container.
 *
 * 10px, matching `StatTile` and `TableCard`. Was 4px, and the radius is set here rather than
 * per screen so the three never drift apart again: a 3px tile beside a 4px card was one of
 * the inconsistencies the redesign started from.
 */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("bg-surface border border-line rounded-[10px]", className)}
      {...props}
    />
  );
}

/** Page title (h1) — 22 / 24 / 28. One per screen. */
export function PageTitle({
  className,
  gradient = false,
  children,
  ...props
}: ComponentProps<"h1"> & {
  /** Paint the heading in `GRADIENT_TEXT` instead of flat ink. */
  gradient?: boolean;
}) {
  return (
    <h1
      className={cn(
        "font-serif text-[22px] sm:text-2xl lg:text-[28px] font-bold m-0",
        // Dropped rather than layered under the gradient — `cn` does not de-duplicate, so
        // leaving it would leave the winner to stylesheet order. See `GRADIENT_TEXT`.
        gradient ? "" : "text-ink",
        className,
      )}
      {...props}
    >
      {gradient ? <span className={GRADIENT_TEXT}>{children}</span> : children}
    </h1>
  );
}

/** Section title (h2) — 18 / 20 / 20. Cards and page sections. */
/**
 * Text painted `ink → accent → plus-light` across its own width, rather than set in one colour.
 *
 * **Put it on a span wrapping the words, not on the heading or button itself.** Two reasons,
 * both of which show up as "the gradient did nothing". It clips every background the element
 * has, so on a filled button or card it would clip the fill away too. And `cn` here is a plain
 * join, not `tailwind-merge`, so a `text-ink` already on the element is not removed — which of
 * it and `text-transparent` wins is down to stylesheet order, not the order they are passed. A
 * bare span carries neither problem.
 *
 * It also needs a box that fits its text: a gradient fills the element's box, not its glyphs,
 * so on a full-width block the light end lands in the empty space beside the words and every
 * letter stays flat ink. `w-fit` below is what prevents that.
 *
 * The light end is `plus-light`, about 5.3:1 on white, so text set in this clears AA at body
 * size and not only at display size.
 */
export const GRADIENT_TEXT =
  "w-fit bg-clip-text text-transparent " +
  "bg-[linear-gradient(105deg,var(--color-ink)_0%,var(--color-accent)_55%,var(--color-plus-light)_100%)]";

export function SectionTitle({
  className,
  gradient = false,
  children,
  ...props
}: ComponentProps<"h2"> & {
  /** Paint the heading in `GRADIENT_TEXT` instead of flat ink. */
  gradient?: boolean;
}) {
  return (
    <h2
      className={cn(
        "font-serif text-lg sm:text-xl font-bold m-0",
        // Dropped entirely when the gradient is on rather than layered under it: `cn` does not
        // de-duplicate, so leaving `text-ink` in place would leave the winner to stylesheet
        // order. See `GRADIENT_TEXT`.
        gradient ? "" : "text-ink",
        className,
      )}
      {...props}
    >
      {gradient ? <span className={GRADIENT_TEXT}>{children}</span> : children}
    </h2>
  );
}

/** Subsection title (h3) — 16 / 17. Groups inside a card. */
export function SubsectionTitle({
  className,
  gradient = false,
  children,
  ...props
}: ComponentProps<"h3"> & {
  /** Paint the heading in `GRADIENT_TEXT` instead of flat ink. */
  gradient?: boolean;
}) {
  return (
    <h3
      className={cn(
        "font-serif text-base sm:text-[17px] font-bold m-0",
        gradient ? "" : "text-ink",
        className,
      )}
      {...props}
    >
      {gradient ? <span className={GRADIENT_TEXT}>{children}</span> : children}
    </h3>
  );
}

/** Muted paragraph under a title — 15 / 16. */
export function Subtext({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("text-[15px] sm:text-base text-sub leading-relaxed m-0", className)}
      {...props}
    />
  );
}

/**
 * A screen's title, its subtext and its controls.
 *
 * Kept as one component because the order matters and is easy to get wrong: putting a
 * control in a `justify-between` row with the title makes the subtext wrap *below* the
 * control on a phone, orphaning it from the heading it describes. Here the title block
 * always stays together and the actions drop beneath it.
 */
export function PageHeader({
  title,
  subtext,
  actions,
  className,
}: {
  title: ReactNode;
  subtext?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // `lg:items-start`, not `items-end`. The actions carry `ACTION_CLEARANCE` to clear the
        // layout's floating selectors, and with a bottom-aligned row that extra height pushed
        // the title down with them — 48px of empty space above every heading on the five
        // screens that use this. Top-aligned, the clearance moves only the thing it is for.
        "flex flex-col gap-3 mb-6 sm:mb-[26px] lg:flex-row lg:items-start lg:justify-between lg:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        <PageTitle className="mb-1.5">{title}</PageTitle>
        {subtext && <Subtext>{subtext}</Subtext>}
      </div>
      {/* Cleared past the layout's selectors — see `ACTION_CLEARANCE`. */}
      {actions && (
        <div className={cn("flex flex-wrap items-end gap-3 shrink-0", ACTION_CLEARANCE)}>
          {actions}
        </div>
      )}
    </div>
  );
}

/** Small uppercase eyebrow, used for onboarding steps and variant labels. */
export function Eyebrow({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("text-[13px] uppercase tracking-[0.1em] text-sub font-bold", className)}
      {...props}
    />
  );
}

/**
 * Blocking / error panel. `tone="blocking"` is the 2px-bordered treatment the rules
 * require for states that stop an action (R4.3); `tone="notice"` is the lighter strip.
 */
export function DangerPanel({
  tone = "blocking",
  title,
  children,
  className,
}: {
  tone?: "blocking" | "notice";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-danger-bg text-danger rounded-[3px]",
        tone === "blocking" ? "border-2 border-danger p-4 sm:p-5" : "border border-danger px-3 py-2.5 sm:px-4 sm:py-3",
        className,
      )}
      role="alert"
    >
      {title && (
        <div
          className={cn(
            "font-bold text-danger",
            tone === "blocking" ? "font-serif text-lg sm:text-xl" : "text-[15px] sm:text-base",
          )}
        >
          {title}
        </div>
      )}
      {children && (
        <div className={cn("text-[15px] leading-relaxed", title ? "mt-2.5" : undefined)}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Dashed placeholder for "nothing here yet". */
export function EmptyState({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "border border-dashed border-line rounded-[3px] py-10 sm:py-14 px-4 sm:px-6 text-center text-[15px] sm:text-base text-sub",
        className,
      )}
      {...props}
    />
  );
}

/** Green "✓ Saved" confirmation shown beside a section's Save button. */
export function SavedTick({ children = "Saved" }: { children?: ReactNode }) {
  return (
    <span className="text-[15px] font-bold text-success" role="status">
      ✓ {children}
    </span>
  );
}
