"use client";

/**
 * The first-run tour engine (Phase 7, D-94) — one spotlight-and-card walkthrough component,
 * reused by all four tours. Not built on `OverlayShell` (`overlay-shell.tsx`): that component
 * assumes one interactive surface with everything else inert, which fits `Modal`/`Dialog`
 * exactly but not a tour, which needs a *visible* (though still inert — see below) real page
 * element behind a spotlight cutout as well as its own interactive card. It does reuse
 * `OverlayShell`'s two proven mechanics: portal to `document.body`, and `inert` on every
 * background sibling so nothing behind the tour is reachable by Tab, click, or a screen reader
 * while it's open (Open Question 2, docs/PHASE-7.md §7: a tour blocks the rest of the page —
 * Skip is the only way out, not clicking around it).
 *
 * A step whose target isn't on the page right now is dropped, not blocked on — this single
 * rule is what makes every "only when relevant" case in the spec work (the funding-source
 * step, the "cannot be downloaded yet" step, Recurring's two-button fallback) with no special
 * casing per tour (docs/PHASE-7.md decision 3.6).
 */
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button, buttonClassName } from "@/src/components/ui/button";
import type { TourKey } from "@/src/db/schema";
import { completeTourAction } from "@/src/modules/tours/actions";

export type TourStep = {
  /**
   * One or more `data-tour` values, tried in order — the first one present in the DOM wins.
   * A single string for an ordinary step; an array for Recurring's "prefer this button, else
   * fall back to that one" case.
   */
  target: string | readonly string[];
  title: string;
  body: string;
};

const GAP = 12;
const MARGIN = 12;
/** Below this viewport width, a step anchored high on the page (the sticky header/nav) docks
 *  to the bottom of the screen instead of trying to float near a target that may sit partly
 *  under, or right against, the very top of a short phone viewport (docs/PHASE-7.md §3.10). */
const MOBILE_BREAKPOINT = 640;
const DOCK_THRESHOLD_TOP = 140;

type Resolved = { el: HTMLElement; step: TourStep };

export function TourGuide({
  tour,
  steps,
  alreadySeen,
}: {
  tour: TourKey;
  steps: readonly TourStep[];
  alreadySeen: boolean;
}) {
  // `null` = not yet resolved (or nothing to show); a resolved, non-empty array = running.
  const [resolved, setResolved] = useState<Resolved[] | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const skipRef = useRef<HTMLButtonElement>(null);

  // Resolved once, after the rest of the page has had its own first render — the real elements
  // a step targets have to exist before `document.querySelector` can find them, which can only
  // be true once the whole tree (this component's siblings included) has committed to the DOM,
  // not merely once this component's own effect body starts running.
  //
  // The `setResolved` call is deferred one animation frame rather than called directly in the
  // effect body: this genuinely needs an effect (it reads real, other-component DOM nodes that
  // don't exist yet during render), but calling setState synchronously inside one still trips
  // `react-hooks/set-state-in-effect` — the same rule `audit-diff.tsx` avoids by restructuring
  // around `key`-remounting, which doesn't apply here (this isn't resetting state when a prop
  // changes, it's a one-time post-mount DOM read). Deferring by a frame is the accepted way to
  // satisfy that rule when an effect's job is unavoidably "read the committed DOM, then react."
  useEffect(() => {
    if (alreadySeen) return;
    const frame = window.requestAnimationFrame(() => {
      const list = steps
        .map((step): Resolved | null => {
          const candidates = Array.isArray(step.target) ? step.target : [step.target];
          for (const key of candidates) {
            const el = document.querySelector<HTMLElement>(`[data-tour="${key}"]`);
            if (el) return { el, step };
          }
          return null;
        })
        .filter((row): row is Resolved => row !== null);
      // Nothing this tour could show right now (every target absent): don't mark it seen —
      // there was nothing to skip or finish, so it should still try again on the next visit.
      setResolved(list);
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadySeen]);

  const running = resolved !== null && resolved.length > 0;
  const active = running ? resolved[index] : null;

  // Scroll the target into view, then measure it — re-measuring on resize/scroll keeps a step
  // anchored through an orientation change or content shifting under it.
  useLayoutEffect(() => {
    if (!active) return;
    active.el.scrollIntoView({ block: "center", behavior: "smooth" });
    function measure() {
      if (active) setRect(active.el.getBoundingClientRect());
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
  }, [active]);

  // Background containment: every sibling of the portal becomes unreachable while a tour is
  // open, matching `OverlayShell`. The spotlighted element stays visually revealed through the
  // cutout below, but not interactively reachable — the tour's own card is the only live
  // control surface, and Skip is always in it.
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
        finish();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  function finish() {
    setResolved([]);
    void completeTourAction(tour);
  }

  if (!running || !active || !rect || typeof document === "undefined") return null;

  const isLast = index === resolved.length - 1;
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
    const placeBelow = spaceBelow > 180 || spaceBelow > rect.top;
    cardTop = placeBelow ? rect.bottom + GAP : rect.top - GAP;
    cardLeft = Math.min(
      Math.max(rect.left, MARGIN),
      viewportWidth - cardWidth - MARGIN,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[60]" role="region" aria-label="App guide">
      {/* Four dark strips around the target, rather than a box-shadow spread trick — simpler
       *  to reason about and unaffected by the target's own border-radius/overflow. */}
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
          dockToBottom
            ? "absolute -translate-x-1/2 -translate-y-full bg-surface border border-line rounded-[3px] shadow-xl p-4 sm:p-5"
            : "absolute bg-surface border border-line rounded-[3px] shadow-xl p-4 sm:p-5"
        }
        style={{ top: cardTop, left: cardLeft, width: cardWidth }}
      >
        <div className="text-[13px] text-sub mb-1.5">
          Step {index + 1} of {resolved.length}
        </div>
        <div className="font-serif text-lg font-bold text-ink mb-1.5">{active.step.title}</div>
        <div className="text-[15px] text-ink leading-relaxed mb-4">{active.step.body}</div>
        <div className="flex items-center justify-between gap-3">
          {/* A plain button, not `Button`: that component is a bare function, not
              `forwardRef`-wrapped, so it can't take the ref this needs for initial focus. */}
          <button
            ref={skipRef}
            type="button"
            className={buttonClassName("quiet")}
            onClick={finish}
          >
            Skip
          </button>
          <div className="flex gap-2">
            {index > 0 && (
              <Button variant="secondary" onClick={() => setIndex((i) => i - 1)}>
                Back
              </Button>
            )}
            <Button onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}>
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
