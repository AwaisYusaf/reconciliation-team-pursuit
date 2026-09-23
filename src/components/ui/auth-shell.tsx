import Image from "next/image";
import type { ReactNode } from "react";

import { GRADIENT_TEXT } from "@/src/components/ui/surfaces";
import { formatMoney } from "@/src/domain/format";

/**
 * The two shapes a signed-out screen comes in.
 *
 * `AuthSplit` is sign in and sign up: a branded panel beside the form, which is the first
 * impression and the only place this product gets to say what it is before someone is inside
 * it. `AuthCentered` is the onboarding steps, which are wide forms already past that point —
 * squeezing a budget table into half a screen to keep the decoration would be decoration
 * winning over the task.
 */

/** The brand ramp, dark. The same `accent-dark` → `accent` → `plus-light` family as the
 *  primary button and the Plus badge, run long so a full-height panel has somewhere to go. */
const BRAND_PANEL =
  "bg-[linear-gradient(155deg,var(--color-accent-dark)_0%,var(--color-accent)_45%,var(--color-plus-light)_100%)]";

/**
 * The cards floating on the brand panel.
 *
 * Three things make them read as objects rather than as white rectangles: the hero card's own
 * wash instead of flat white, a hairline border, and a lit top edge. On a dark panel a plain
 * white card has no edge at the top, where the light is coming from, so it looks pasted on.
 *
 * The border is `white/70` rather than `line`: these sit on brown, so the frame that reads as
 * an edge is a lighter one than the app's own hairline, which is tuned for white on paper.
 */
const GLASS_CARD =
  "border border-white/70 " +
  "bg-[linear-gradient(to_top,var(--color-hero-wash)_0%,var(--color-surface)_70%)] " +
  // One `box-shadow`, not two utilities. Both `shadow-warm-glow` and an inset set the same
  // property, so on one element the stylesheet's order decides which survives and the other
  // silently does nothing. The drop is cast in the panel's own brown-black rather than the
  // theme's warm glow, which is tuned to be seen on paper and vanishes on this ground.
  "shadow-[0_18px_40px_-12px_rgba(43,26,16,0.55),inset_0_1px_0_rgba(255,255,255,0.9)]";

export function AuthSplit({ children }: { children: ReactNode }) {
  return (
    // Full screen, with the window's own white as the frame. The gradient is inset by that
    // padding and keeps its radius, so it reads as a panel laid on the page rather than as
    // the page being cut in half.
    //
    // `min-h-dvh` on the outside and `dvh` minus the padding on the grid: `vh` on a phone
    // browser measures the viewport without the address bar, which leaves the frame short at
    // the bottom until the bar hides itself.
    <div className="min-h-dvh bg-surface p-3 sm:p-4">
      <div className="min-h-[calc(100dvh-1.5rem)] sm:min-h-[calc(100dvh-2rem)] grid md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3 sm:gap-4">
        {/*
          The panel appears from `md` (768px), not `lg`. At `lg` a 900px-wide laptop window got
          no panel at all and the screen fell back to a bare form floating on white, which does
          not look like the same product.

          Below `md` it still goes: on a phone a full-height block of brown above the form
          pushes the fields off the first screen, which is the one thing a sign-in page must
          not do. The compact band below covers that width instead.
        */}
        <aside
          className={`${BRAND_PANEL} hidden md:flex flex-col justify-between rounded-[18px] p-7 lg:p-9 xl:p-12 relative overflow-hidden`}
        >
        {/*
          Three soft lights over the base ramp. A single linear gradient on a full-height
          panel reads as a painted wall; the radials are what give it depth.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_40%_at_20%_8%,rgba(255,255,255,0.22)_0%,transparent_100%),radial-gradient(50%_35%_at_85%_30%,color-mix(in_srgb,var(--color-plus-light)_65%,transparent)_0%,transparent_100%),radial-gradient(60%_45%_at_50%_100%,rgba(43,26,16,0.45)_0%,transparent_100%)]"
        />

        <div className="relative">
          <Image
            src="/brand/stayfunded-mark.png"
            alt="Stay Funded 360"
            width={628}
            height={570}
            priority
            className="h-10 w-auto"
            style={{ width: "auto" }}
          />
        </div>

        {/*
          A glimpse of the product, drawn with the app's own cards rather than a screenshot: a
          screenshot dates the moment any screen changes, and at this size it would be
          unreadable anyway.

          `aria-hidden` on the whole group. The figures are illustrative, and a screen reader
          announcing a balance and a spend total on the sign-in page would be stating numbers
          that belong to nobody. Nothing here is information, so nothing is lost by hiding it.
        */}
        <div aria-hidden="true" className="relative my-10 flex justify-center">
          <div className="w-full max-w-[340px]">
            {/* The headline card, tilted a degree: square to the panel it reads as a UI
                embedded in the page rather than as an object resting on it. */}
            <div className={`${GLASS_CARD} rounded-[14px] p-4 -rotate-[1.5deg]`}>
              <div className="flex items-start justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.06em] font-bold text-sub">
                  Total remaining
                </div>
                <span className="rounded-full border border-line bg-surface/70 px-2.5 py-1 text-[11px] font-bold text-sub">
                  36% committed
                </span>
              </div>
              <div className={`font-bold tabular-nums text-[26px] leading-none mt-2 ${GRADIENT_TEXT}`}>
                {formatMoney(113814793)}
              </div>
              {/*
                `rounded-[4px]`, not `rounded-full`. A pill radius on a bar only a few pixels
                tall eats the whole bar and leaves a row of blobs with no readable height,
                which is what the first pass looked like.
              */}
              <div className="flex items-end gap-1.5 h-12 mt-4">
                {[42, 68, 28, 84, 52, 96, 38, 64, 24, 72].map((height, bar) => (
                  <div
                    key={bar}
                    className={`flex-1 rounded-[4px] ${
                      bar === 5
                        ? "bg-[linear-gradient(to_top,var(--color-accent-dark)_0%,var(--color-plus-light)_100%)]"
                        : "bg-accent/25"
                    }`}
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
            </div>

            {/* Two tiles under it, pulled up so they overlap the card's shadow. */}
            <div className="grid grid-cols-2 gap-2.5 -mt-2 ml-6 rotate-[1.5deg]">
              <div className={`${GLASS_CARD} rounded-[12px] p-3`}>
                <div className="text-[10px] uppercase tracking-[0.06em] font-bold text-sub">
                  Spent this month
                </div>
                <div className="font-bold tabular-nums text-[17px] leading-none mt-1.5 text-ink">
                  {formatMoney(5397887)}
                </div>
              </div>
              <div className={`${GLASS_CARD} rounded-[12px] p-3`}>
                <div className="text-[10px] uppercase tracking-[0.06em] font-bold text-sub">
                  Packet
                </div>
                <div className="font-bold text-[17px] leading-none mt-1.5 text-success">
                  Ready
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative">
          <p className="text-[15px] text-surface/75 m-0">You can easily</p>
          <h2 className="font-serif text-[32px] xl:text-[38px] font-bold leading-[1.18] text-surface mt-2.5 mb-0 max-w-[16ch]">
            Track every dollar, document it, and stay compliant.
          </h2>
        </div>
        </aside>

        {/* The form side. The frame's own white, so it needs no fill of its own. */}
        {/*
          `justify-start` on a phone, centred from `md`. Vertically centring a short form in a
          full-height column leaves a band of empty white above and below it and the content
          floating in the middle of nothing; on a narrow screen it should start near the top
          and simply scroll.
        */}
        <main className="flex flex-col justify-start md:justify-center px-5 sm:px-8 py-7 md:py-8 min-w-0">
          <div className="w-full max-w-[400px] mx-auto">
            {/*
              The phone's stand-in for the panel: the mark over one line on the same ramp,
              short enough that the first field is still on screen under it. Without this,
              every width below `md` is a form with no branding on it at all.

              Stacked and centred rather than a mark beside text. Side by side, a 32px mark
              and a three-line sentence left both cramped and neither readable.
            */}
            <div
              className={`${BRAND_PANEL} md:hidden rounded-[16px] px-6 py-6 mb-8 text-center`}
            >
              <Image
                src="/brand/stayfunded-mark.png"
                alt="Stay Funded 360"
                width={628}
                height={570}
                priority
                className="h-10 w-auto mx-auto"
                style={{ width: "auto" }}
              />
              <p className="font-serif text-[17px] font-bold leading-snug text-surface mt-3 mb-0">
                Track every dollar, document it, stay compliant.
              </p>
            </div>

            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/** The onboarding steps: one wide card on the paper page, with the ramp washed in behind it. */
export function AuthCentered({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-paper flex items-start justify-center px-4 sm:px-6 py-10 sm:py-14">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_top,var(--color-hero-wash)_0%,var(--color-paper)_55%)]"
      />
      <div className="relative w-full flex justify-center">{children}</div>
    </div>
  );
}
