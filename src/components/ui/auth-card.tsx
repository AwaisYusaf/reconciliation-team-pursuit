import type { ReactNode } from "react";

import { PageTitle } from "@/src/components/ui/surfaces";
import { cn } from "@/src/lib/cn";

/**
 * The panel every signed-out screen sits in: sign in, sign up, and the two onboarding steps.
 *
 * One component rather than the same markup pasted into each page, which is how the two ended
 * up with the same card written twice and the signups-closed variant written a third time.
 *
 * No brand mark inside it. The mark sits in the layout's top bar, where it names the product
 * once for the whole screen; repeating it here made the card a third of logo before anyone
 * reached a field.
 */
/**
 * Shorter controls for the signed-out forms.
 *
 * The app's `CONTROL` is 44px tall for touch, which is right inside the product — those forms
 * are filled on a phone in the field. Sign up is five fields on a laptop and has to fit the
 * window without scrolling, so these come down to 40px.
 *
 * `!` on both, not plain utilities. `cn` here is a join, not `tailwind-merge`, so `min-h-11`
 * from `CONTROL` would still be in the class list and which of the two won would be down to
 * stylesheet order rather than to this being passed last.
 */
export const AUTH_FIELD = "min-h-10! py-2!";

export function AuthCard({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  width = "md",
  bare = false,
  className,
}: {
  /** The small line above the title, for "Step 2 of 2" on the onboarding steps. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One line under the title, for context the title cannot carry on its own. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** The "Already have an account?" line, set off by a rule. */
  footer?: ReactNode;
  /** `lg` for the onboarding steps, which hold a table rather than three fields. */
  width?: "md" | "lg";
  /**
   * Drop the card chrome: no fill, no radius, no shadow, no padding.
   *
   * For `AuthSplit`, whose form side is already a white half-screen. A card there would be a
   * white panel on a white panel, which is an outline around nothing.
   */
  bare?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full",
        bare
          ? null
          : cn(
              width === "lg" ? "max-w-[720px]" : "max-w-[440px]",
              // 16px and a warm shadow instead of a 4px hairline box. The shadow is doing real
              // work: the card sits over a gradient, and with no lift it reads as a hole cut
              // in it.
              "bg-surface rounded-[16px] shadow-warm-glow border border-white/60",
              "px-6 sm:px-8 pt-7 sm:pt-8 pb-7",
            ),
        className,
      )}
    >
      {/*
        Left-aligned, with the fields beneath it. Centred headings over left-aligned labels
        give a form two different starting edges, which is the detail that makes a sign-in
        page look thrown together.
      */}
      {eyebrow && <div className="mb-2.5">{eyebrow}</div>}
      <PageTitle gradient className="text-[22px] sm:text-[26px] leading-tight">
        {title}
      </PageTitle>
      {subtitle && (
        <p className="text-[15px] text-sub leading-relaxed mt-1.5 mb-0">{subtitle}</p>
      )}

      {/*
        Tight on purpose. Sign up carries five fields, and the brief is that it fits a laptop
        window without scrolling — every gap here is paid for five times over down the form.
      */}
      <div className="mt-5">{children}</div>

      {footer && (
        <div className="border-t border-line mt-5 pt-4 text-center text-[15px] text-sub">
          {footer}
        </div>
      )}
    </div>
  );
}
