"use client";

/**
 * The first-run tour engine (Phase 7, D-94/D-95) — one spotlight-and-card walkthrough
 * component, reused by every tour. Not built on `OverlayShell` (`overlay-shell.tsx`): that
 * component assumes one interactive surface with everything else inert, which fits
 * `Modal`/`Dialog` exactly but not a tour, which needs a *visible* (though still inert — see
 * below) real page element behind a spotlight cutout as well as its own interactive card. It
 * does reuse `OverlayShell`'s two proven mechanics: portal to `document.body`, and `inert` on
 * every background sibling so nothing behind the tour is reachable by Tab, click, or a screen
 * reader while it's open (Open Question 2, docs/PHASE-7.md §7: a tour blocks the rest of the
 * page — Skip is the only way out, not clicking around it).
 *
 * Steps resolve one at a time, in order, not all up front: a step's `autoOpen` (D-95) is
 * clicked first, giving the *host page* a chance to switch a tab, open a modal, or pop a menu
 * open before this step's own `target` is looked up — which is what lets a tour actually walk
 * into Settings' six sections, open Line Items' "Manage" panel, or open an Expenses row's ⋮
 * menu, rather than only ever pointing at whatever already happens to be on screen. A step
 * whose `target` still isn't found afterwards is skipped forward, not blocked on — the one
 * mechanism that covers every "only when relevant" case in the spec (the funding-source step,
 * the "cannot be downloaded yet" step, Recurring's two-button fallback) with no special casing
 * per tour (docs/PHASE-7.md decision 3.6). Reaching the end of the list without having shown
 * anything at all means there was nothing to skip or finish, so the tour isn't marked seen —
 * it tries again on the next visit; reaching the end *after* showing at least one step finishes
 * the tour normally, same as clicking Done on a real last step.
 */
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button, buttonClassName } from "@/src/components/ui/button";
import type { TourKey } from "@/src/db/schema";
import { completeTourAction } from "@/src/modules/tours/actions";
import { resolveOneStep, type TourStep } from "@/src/modules/tours/resolve-steps";
import { nextInSequence, TOUR_SEQUENCE_KEY } from "@/src/modules/tours/sequence";

export type { TourStep };

const GAP = 12;
const MARGIN = 12;
/** Below this viewport width, a step anchored high on the page (the sticky header/nav) docks
 *  to the bottom of the screen instead of trying to float near a target that may sit partly
 *  under, or right against, the very top of a short phone viewport (docs/PHASE-7.md §3.10). */
const MOBILE_BREAKPOINT = 640;
const DOCK_THRESHOLD_TOP = 140;
/** A conservative upper bound for the step card's own height (label + title + a few lines of
 *  body + buttons + padding), used to keep it fully on-screen without a second measurement
 *  pass. `max-h` + `overflow-y-auto` on the card itself is the backstop if real content ever
 *  runs taller than this. */
const ESTIMATED_CARD_HEIGHT = 260;

type Current = { el: HTMLElement; step: TourStep };

function findByDataTour(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${key}"]`);
}

export function TourGuide({
  tour,
  steps,
  alreadySeen,
}: {
  tour: TourKey;
  steps: readonly TourStep[];
  alreadySeen: boolean;
}) {
  const [begun, setBegun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [current, setCurrent] = useState<Current | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  // Whether this tour has successfully shown at least one step yet — decides both the
  // "never showed anything, don't mark seen" rule below and, for Dashboard specifically, when
  // the guided walkthrough sequence begins (see the resolution effect).
  const shownAnyRef = useRef(false);

  // Gate the whole engine behind one animation frame after mount, same reasoning as the old
  // single-pass resolver: `alreadySeen` itself is available synchronously, but flipping
  // `begun` still has to happen from an effect, not render, and a bare synchronous `setBegun`
  // inside this effect trips `react-hooks/set-state-in-effect` for the same reason deferring by
  // a frame was already the accepted fix elsewhere in this file.
  useEffect(() => {
    if (alreadySeen) return;
    const frame = window.requestAnimationFrame(() => setBegun(true));
    return () => window.cancelAnimationFrame(frame);
  }, [alreadySeen]);

  // The per-step resolver: `autoOpen` (if present) is clicked, then — one more frame later, so
  // whatever it triggered (a tab switch, a modal, a menu) has had a chance to actually commit —
  // `target` is looked up. Found: show it. Not found: this step is skipped forward, which
  // re-triggers this same effect for the next index. Running off the end of `steps` either
  // finishes the tour (something was shown) or simply gives up quietly (nothing ever was).
  useEffect(() => {
    if (!begun) return;
    let cancelled = false;
    let innerFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      if (stepIndex >= steps.length) {
        if (shownAnyRef.current) finish(false);
        return;
      }
      const step = steps[stepIndex];
      if (step.autoOpen) {
        const opener = findByDataTour(step.autoOpen);
        // Skipped when already open (`aria-expanded="true"`) so revisiting this step via Back
        // can't toggle a real menu/disclosure back closed by clicking its trigger a second time.
        if (opener && opener.getAttribute("aria-expanded") !== "true") opener.click();
      }
      innerFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        const el = resolveOneStep(step, findByDataTour);
        if (!el) {
          setStepIndex((i) => i + 1);
          return;
        }
        if (tour === "dashboard" && !shownAnyRef.current) {
          // Dashboard is always `TOUR_SEQUENCE`'s first stop (`sequence.ts`) and this is the
          // one point every brand-new user's very first tour passes through, so it's where the
          // guided walkthrough begins: mark it active so this tour's own Finish knows to carry
          // the user on to the next tab instead of just closing.
          try {
            sessionStorage.setItem(TOUR_SEQUENCE_KEY, "1");
          } catch {
            // Private-browsing/storage-blocked: the walkthrough just won't auto-advance; each
            // tour still shows on its own tab as before.
          }
        }
        shownAnyRef.current = true;
        setCurrent({ el, step });
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [begun, stepIndex]);

  const running = current !== null;

  // Scroll the target into view, then measure it — re-measuring on resize/scroll keeps a step
  // anchored through an orientation change or content shifting under it.
  useLayoutEffect(() => {
    if (!current) return;
    current.el.scrollIntoView({ block: "center", behavior: "smooth" });
    function measure() {
      if (current) setRect(current.el.getBoundingClientRect());
    }
    measure();
    const settle = window.setTimeout(measure, 260);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [current]);

  // Background containment: every sibling of the portal becomes unreachable while a tour is
  // open, matching `OverlayShell`. The spotlighted element stays visually revealed through the
  // cutout below, but not interactively reachable — the tour's own card is the only live
  // control surface, and Skip is always in it. A `data-tour="autoOpen"` target (a menu panel, a
  // modal) that gets portaled to `document.body` *after* this effect runs is a new sibling by
  // the time it appears, so it is never marked `inert` in the first place — exactly the one
  // thing this step is trying to reveal stays genuinely interactive.
  useEffect(() => {
    if (!running) return;
    const marked: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement) || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      marked.push(child);
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    skipRef.current?.focus();
    return () => {
      for (const el of marked) el.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
    };
  }, [running]);

  useEffect(() => {
    if (!running) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  /**
   * `skipped` decides what happens to the guided walkthrough, not just this one tour (both
   * still write the same "seen" row — spec: "Skipping or finishing means it doesn't show
   * again"). Skip (or Escape) is treated as "stop guiding me", not just "not this tour": it
   * cancels the rest of the sequence outright rather than silently carrying the user to the
   * next tab anyway. Finishing the last step, with the sequence still active, navigates on to
   * `TOUR_SEQUENCE`'s next tab — that tab's own `TourGuide`, freshly server-rendered with
   * `alreadySeen: false`, picks up from there. Reaching the end of the list, or a target page
   * whose own tour has nothing to show (e.g. Packet while "All funding sources" is still
   * selected), simply lets the sequence run out rather than trying to skip ahead further.
   */
  function finish(skipped: boolean) {
    setCurrent(null);
    void completeTourAction(tour);
    if (skipped) {
      try {
        sessionStorage.removeItem(TOUR_SEQUENCE_KEY);
      } catch {
        // Nothing to clean up if storage isn't available in the first place.
      }
      return;
    }
    let sequenceActive = false;
    try {
      sequenceActive = sessionStorage.getItem(TOUR_SEQUENCE_KEY) === "1";
    } catch {
      // Treated as "not active" — same as a fresh session with no flag set.
    }
    if (!sequenceActive) return;
    const next = nextInSequence(tour);
    if (next) {
      // `refresh()` right after `push()` isn't redundant: Next's client Router Cache can serve
      // a prefetched RSC payload for `next.href` (every route is a `<Link>` in the nav bar, so
      // the browser may have prefetched it well before this tour ever finished) — one computed
      // from whatever `hasSeenTour` returned *at prefetch time*, which can predate this tour's
      // own `completeTourAction` write. Without this, the next tour can silently fail to
      // start (its `alreadySeen` prop is stale-true) or, in principle, the reverse. `refresh()`
      // forces the newly-navigated route's server components to re-run against current data.
      router.push(next.href);
      router.refresh();
    } else {
      try {
        sessionStorage.removeItem(TOUR_SEQUENCE_KEY);
      } catch {
        // No-op — nothing left to guide toward either way.
      }
    }
  }

  if (!current || !rect || typeof document === "undefined") return null;

  const isLast = stepIndex === steps.length - 1;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const dockToBottom = viewportWidth < MOBILE_BREAKPOINT && rect.top < DOCK_THRESHOLD_TOP;

  const cardWidth = Math.min(340, viewportWidth - MARGIN * 2);
  let cardTop: number;
  let cardLeft: number;
  if (dockToBottom) {
    cardTop = viewportHeight - MARGIN; // positioned via bottom-anchored transform below
    cardLeft = viewportWidth / 2;
  } else {
    const spaceBelow = viewportHeight - rect.bottom;
    // Needs at least a card's worth of room below to actually fit there, not just "some" —
    // the original 180px threshold was smaller than a real card (title + a few lines of body
    // + buttons, easily 220-250px), so a target sitting low on a short, mostly-empty page
    // (Recurring's own empty state, hit live) chose "below" anyway and pushed Skip/Done off
    // the bottom of the viewport, unreachable by mouse — Escape still worked, but that's not
    // good enough (Open Question 2: Skip is meant to be the visible way out).
    const placeBelow = spaceBelow > ESTIMATED_CARD_HEIGHT || spaceBelow > rect.top;
    cardTop = placeBelow
      ? rect.bottom + GAP
      // Anchored by its own estimated bottom edge, not its top — placing "above" by moving
      // only the top edge (the original code) left the card hanging mostly *under* the
      // target instead of above it.
      : rect.top - GAP - ESTIMATED_CARD_HEIGHT;
    // Final hard clamp regardless of branch: whatever the heuristic picked, the card must
    // still fit inside the viewport. `max-h` + `overflow-y-auto` below is the safety net for
    // the rare case where the real rendered height exceeds this estimate anyway (unusually
    // long copy, a large zoom level).
    cardTop = Math.max(MARGIN, Math.min(cardTop, viewportHeight - ESTIMATED_CARD_HEIGHT - MARGIN));
    cardLeft = Math.min(
      Math.max(rect.left, MARGIN),
      viewportWidth - cardWidth - MARGIN,
    );
  }

  return createPortal(
    // `data-tour-overlay`: exempts this portal from `OverlayShell`'s own "inert everything else"
    // containment (`overlay-shell.tsx`) when a step's `autoOpen` pops a real Modal/Dialog open —
    // otherwise that Modal would inert this card out from under itself the instant it appears.
    <div className="fixed inset-0 z-[60]" data-tour-overlay role="region" aria-label="App guide">
      {/* Four dark strips around the target, rather than a box-shadow spread trick — simpler
       *  to reason about and unaffected by the target's own border-radius/overflow. When the
       *  target is a just-`autoOpen`ed menu/panel, `rect` is that panel's own box (its
       *  `data-tour` sits on the panel, not the trigger — see `expenses-tour.ts`), so the hole
       *  cut here lands exactly around it rather than around the small trigger that opened it. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/50" style={{ height: Math.max(0, rect.top - GAP) }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/50" style={{ top: rect.bottom + GAP }} />
      <div className="pointer-events-none absolute bg-black/50" style={{ top: Math.max(0, rect.top - GAP), height: rect.height + GAP * 2, left: 0, width: Math.max(0, rect.left - GAP) }} />
      <div className="pointer-events-none absolute bg-black/50" style={{ top: Math.max(0, rect.top - GAP), height: rect.height + GAP * 2, left: rect.right + GAP, right: 0 }} />
      <div
        className="pointer-events-none absolute rounded-[3px] ring-2 ring-accent"
        style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
      />

      <div
        className={
          (dockToBottom
            ? "absolute -translate-x-1/2 -translate-y-full "
            : "absolute ") +
          "bg-surface border border-line rounded-[3px] shadow-xl p-4 sm:p-5 " +
          "max-h-[calc(100dvh-24px)] overflow-y-auto"
        }
        style={{ top: cardTop, left: cardLeft, width: cardWidth }}
      >
        <div className="text-[13px] text-sub mb-1.5">
          Step {stepIndex + 1} of {steps.length}
        </div>
        <div className="font-serif text-lg font-bold text-ink mb-1.5">{current.step.title}</div>
        <div className="text-[15px] text-ink leading-relaxed mb-4">{current.step.body}</div>
        <div className="flex items-center justify-between gap-3">
          {/* A plain button, not `Button`: that component is a bare function, not
              `forwardRef`-wrapped, so it can't take the ref this needs for initial focus. */}
          <button
            ref={skipRef}
            type="button"
            className={buttonClassName("quiet")}
            onClick={() => finish(true)}
          >
            Skip
          </button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button variant="secondary" onClick={() => setStepIndex((i) => i - 1)}>
                Back
              </Button>
            )}
            <Button onClick={() => (isLast ? finish(false) : setStepIndex((i) => i + 1))}>
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
