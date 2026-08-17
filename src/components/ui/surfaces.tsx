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

/** White panel with the paper-stock border. The app's default container. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("bg-surface border border-line rounded-[4px]", className)}
      {...props}
    />
  );
}

/** Page title (h1) — 22 / 24 / 28. One per screen. */
export function PageTitle({ className, ...props }: ComponentProps<"h1">) {
  return (
    <h1
      className={cn(
        "font-serif text-[22px] sm:text-2xl lg:text-[28px] font-bold text-ink m-0",
        className,
      )}
      {...props}
    />
  );
}

/** Section title (h2) — 18 / 20 / 20. Cards and page sections. */
export function SectionTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn("font-serif text-lg sm:text-xl font-bold text-ink m-0", className)}
      {...props}
    />
  );
}

/** Subsection title (h3) — 16 / 17. Groups inside a card. */
export function SubsectionTitle({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      className={cn("font-serif text-base sm:text-[17px] font-bold text-ink m-0", className)}
      {...props}
    />
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
        "flex flex-col gap-3 mb-6 sm:mb-[26px] lg:flex-row lg:items-end lg:justify-between lg:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        <PageTitle className="mb-1.5">{title}</PageTitle>
        {subtext && <Subtext>{subtext}</Subtext>}
      </div>
      {actions && <div className="flex flex-wrap items-end gap-3 shrink-0">{actions}</div>}
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
