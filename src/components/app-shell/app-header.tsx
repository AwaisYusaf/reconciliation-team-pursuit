"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { cn } from "@/src/lib/cn";

/**
 * Two thresholds, not one, and far apart.
 *
 * Collapsing the bar removes about 90px from the page, which shortens the document and drags
 * `scrollY` down with it. With a single threshold that lands the page back under the line
 * that triggered the collapse, so the bar expands, the page grows, the scroll returns and it
 * collapses again — a loop that ran every frame and made the header visibly shake at the
 * point where it changed, worst at the bottom of a short screen where the scroll has nowhere
 * else to go.
 *
 * Collapsing well after the bar has left the viewport and only expanding again within a few
 * pixels of the very top leaves a gap far wider than the height the collapse removes, so the
 * rebound can never cross back over the line that caused it.
 */
const COLLAPSE_ENTER = 96;
const COLLAPSE_EXIT = 8;

/**
 * The sticky header. Once the page scrolls it sheds the mark, the plan badge, the tour button
 * and the profile menu, leaving only the tabs.
 *
 * The bar has no background at any scroll position, so it reads as part of the page rather
 * than as a white strip laid over it. What keeps the tabs readable once content slides
 * underneath is the solid pill they sit in, in `AppNav` — the background belongs to the thing
 * that needs to stay legible, not to the full width of the screen.
 *
 * Slots rather than children so the server layout keeps ownership of what goes in them. This
 * component adds no data of its own; it only knows whether the page has scrolled.
 *
 * The month and funding-source selectors are deliberately not here. They live at the top of
 * the content column instead, level with each screen's own title.
 */
export function AppHeader({
  logo,
  nav,
  controls,
  account,
}: {
  logo: ReactNode;
  nav: ReactNode;
  /** The decorative controls — plan badge, tour replay. These collapse away on scroll. */
  controls: ReactNode;
  /**
   * The profile menu. Collapses with everything else, so a scrolled page shows only the tabs.
   *
   * Kept as its own slot rather than folded back into `controls` because it sits on the far
   * right and has to keep its `ml-auto` independently of whether the controls beside it have
   * collapsed to zero width and given up theirs.
   */
  account: ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;

    function measure() {
      frame = 0;
      setScrolled((wasScrolled) =>
        wasScrolled ? window.scrollY > COLLAPSE_EXIT : window.scrollY > COLLAPSE_ENTER,
      );
    }

    function onScroll() {
      // One measurement per frame. Scroll fires far more often than the page paints, and the
      // state it sets is purely visual.
      if (frame === 0) frame = requestAnimationFrame(measure);
    }

    // Run once on mount: a reload part-way down a screen restores the scroll position before
    // any scroll event fires, and the bar would otherwise start in the wrong state.
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header
      className={cn(
        // One duration and curve for the bar's padding and for the two blocks collapsing
        // inside it, so the whole thing reads as a single movement rather than three.
        "no-print sticky top-0 z-30 px-4 sm:px-6 transition-[padding] duration-300 ease-out",
        // No background, at any width or scroll position. What stays readable over scrolling
        // content is the tabs' own solid backgrounds, which `AppNav` gives them: one pill
        // around the whole track on a desktop, and a pill per tab on a phone where the track
        // would be clipped. The bar itself is never anything but the page.
        scrolled ? "py-2" : "py-2.5",
      )}
    >
      <div className="max-w-[1220px] mx-auto flex flex-wrap gap-y-2 gap-x-3 sm:gap-x-4 items-center">
        {/*
          Collapsed rather than hidden, so the change can be animated.

          `display: none` cannot be transitioned, so these used to blink out and the tabs
          jumped to fill the space. Animating `max-width` alongside opacity lets them shrink
          out of the row instead, and because the tabs are a flex sibling they slide across as
          that width goes, which is the movement rather than a cut. The negative margin closes
          the row's own `gap` as the element reaches zero width — without it a 12–16px hole
          stays where the mark used to be.

          `inert` while collapsed, not just `pointer-events-none`: these are still in the DOM
          at zero width, and Sign out sits inside the controls. Without it a keyboard user
          could tab into an invisible menu.
        */}
        <div
          inert={scrolled || undefined}
          className={cn(
            "shrink-0 order-1 overflow-hidden transition-all duration-300 ease-out",
            scrolled ? "opacity-0 max-w-0 -mr-3 sm:-mr-4" : "opacity-100 max-w-[80px]",
          )}
        >
          {logo}
        </div>

        {/*
          Beside the mark at every width. `AppNav` collapses to a single menu button below
          `lg`, so it no longer needs a line of its own down there — it is about as wide as
          the longest screen name rather than as wide as nine tabs.
        */}
        <div className="order-2 min-w-0 lg:flex-1">{nav}</div>

        <div
          inert={scrolled || undefined}
          className={cn(
            "flex items-center gap-2 sm:gap-2.5 order-3 ml-auto lg:ml-0",
            "overflow-hidden transition-all duration-300 ease-out",
            scrolled ? "opacity-0 max-w-0 -ml-3 sm:-ml-4" : "opacity-100 max-w-[240px]",
          )}
        >
          {controls}
        </div>

        {/*
          Collapses with everything else, so a scrolled page is the tabs and nothing else.

          The trade, stated because it is a real one: Sign out and Your profile live behind
          this menu and there is no other route to either, so while the page is scrolled they
          are out of reach. Scrolling back to the top brings them straight back, and `inert`
          means a keyboard user cannot tab into the invisible menu in the meantime.
        */}
        <div
          inert={scrolled || undefined}
          className={cn(
            "shrink-0 order-4 ml-auto lg:ml-0",
            "overflow-hidden transition-all duration-300 ease-out",
            scrolled ? "opacity-0 max-w-0 -ml-3 sm:-ml-4" : "opacity-100 max-w-[48px]",
          )}
        >
          {account}
        </div>
      </div>
    </header>
  );
}
