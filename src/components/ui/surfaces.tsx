import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/src/lib/cn";

/** White panel with the paper-stock border. The app's default container. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("bg-surface border border-line rounded-[4px]", className)}
      {...props}
    />
  );
}

/** Page title — Georgia 28px, as in the design. */
export function PageTitle({ className, ...props }: ComponentProps<"h1">) {
  return (
    <h1
      className={cn("font-serif text-[28px] font-bold text-ink m-0", className)}
      {...props}
    />
  );
}

/** Section title — Georgia 20px. */
export function SectionTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2 className={cn("font-serif text-xl font-bold text-ink m-0", className)} {...props} />
  );
}

/** Muted paragraph under a title. */
export function Subtext({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-base text-sub leading-relaxed m-0", className)} {...props} />;
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
        tone === "blocking" ? "border-2 border-danger p-5" : "border border-danger px-4 py-3",
        className,
      )}
      role="alert"
    >
      {title && (
        <div
          className={cn(
            "font-bold text-danger",
            tone === "blocking" ? "font-serif text-xl" : "text-base",
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
        "border border-dashed border-line rounded-[3px] py-14 px-6 text-center text-base text-sub",
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
