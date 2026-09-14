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
import {
  countResolvableAfter,
  fitsVertically,
  popShownStep,
  pushShownStep,
  resolveOneStep,
  sideRoom,
  type TourStep,
} from "@/src/modules/tours/resolve-steps";
import {
  continueTourSequence,
  TOUR_REPLAY_EVENT,
  TOUR_SEQUENCE_KEY,
} from "@/src/modules/tours/sequence";

export type { TourStep };

const GAP = 12;
const MARGIN = 12;
/** How far the lit cutout and the accent ring each sit outside the target, and the radius each
 *  is drawn with. `SPOTLIGHT_RADIUS` is derived rather than picked so the two curves stay
 *  concentric: an outer box needs its inner box's radius plus the gap between them to run
 *  parallel to it, otherwise the corners visibly pinch. */
const SPOTLIGHT_PAD = 12;
const RING_PAD = 4;
const RING_RADIUS = 6;
const SPOTLIGHT_RADIUS = RING_RADIUS + (SPOTLIGHT_PAD - RING_PAD);
/** Below this viewport width, a step anchored high on the page (the sticky header/nav) docks
 *  to the bottom of the screen instead of trying to float near a target that may sit partly
 *  under, or right against, the very top of a short phone viewport (docs/PHASE-7.md §3.10). */
const MOBILE_BREAKPOINT = 640;
const DOCK_THRESHOLD_TOP = 140;
/** A conservative upper bound for the step card's own height (label + title + a few lines of
 *  body + buttons + padding), used to keep it fully on-screen without a second measurement
 *  pass. `max-h` + `overflow-y-auto` on the card itself is the backstop if real content ever
 *  runs taller than this. */
const ESTIMATED_CARD_HEIGHT = 285;

type Current = { el: HTMLElement; step: TourStep };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

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
  // How many steps after the current one are still expected to show, measured when the step is
  // shown. Drives both the counter's total and "is this really the last card" — see
  // `countResolvableAfter`.
  const [remaining, setRemaining] = useState(0);
  // Bumped by the replay (i) button to force a fresh run even when no prop and no other piece
  // of state actually changed (see the replay effect below).
  const [runId, setRunId] = useState(0);
  const skipRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  // Whether this tour has successfully shown at least one step yet — decides both the
  // "never showed anything, don't mark seen" rule below and, for Dashboard specifically, when
  // the guided walkthrough sequence begins (see the resolution effect).
  const shownAnyRef = useRef(false);
  // The indices actually shown so far, oldest first. Back walks *this*, not `stepIndex - 1`:
  // a step that was dropped on the way forward (its target wasn't on the page) is not a step
  // the user ever saw, and decrementing blindly landed on it, failed to resolve it, and let
  // the resolver push straight forward again — so Back silently did nothing (review fix).
  const historyRef = useRef<number[]>([]);
  // Whether any step's `autoOpen` actually opened something dismissible. Set when a click is
  // performed, cleared when the tour tidies up after itself — see `closeAnythingOpened`.
  const openedRef = useRef(false);

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
        if (shownAnyRef.current) {
          finish(false);
        } else {
          // Every step was dropped — there was nothing on this screen worth pointing at, so
          // the tour is deliberately *not* marked seen and will try again on the next visit.
          // A walkthrough in progress still has to move on, though: leaving it parked here is
          // what stopped the chain at the first screen with an empty list and never reached
          // the tabs after it.
          continueTourSequence(tour, router);
        }
        return;
      }
      const step = steps[stepIndex];
      if (step.autoOpen) {
        const opener = findByDataTour(step.autoOpen);
        // Skipped when already open (`aria-expanded="true"`) so revisiting this step via Back
        // can't toggle a real menu/disclosure back closed by clicking its trigger a second time.
        if (opener && opener.getAttribute("aria-expanded") !== "true") {
          opener.click();
          openedRef.current = true;
        }
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
        historyRef.current = pushShownStep(historyRef.current, stepIndex);
        setRemaining(countResolvableAfter(steps, stepIndex, findByDataTour));
        setCurrent({ el, step });
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [begun, stepIndex, runId]);

  // Re-arm on the header's replay (i) button for this tour. A plain `router.refresh()` cannot
  // reach this component when the tour already ran during this same page visit — see
  // `TOUR_REPLAY_EVENT`. `runId` is what guarantees the resolver re-runs even when `stepIndex`
  // is already 0 (a tour skipped on its very first step).
  useEffect(() => {
    function onReplay(event: Event) {
      if ((event as CustomEvent<TourKey>).detail !== tour) return;
      historyRef.current = [];
      shownAnyRef.current = false;
      setCurrent(null);
      setRect(null);
      setStepIndex(0);
      setBegun(true);
      setRunId((id) => id + 1);
    }
    window.addEventListener(TOUR_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, onReplay);
  }, [tour]);

  const running = current !== null;

  // Scroll the target into view, then measure it — re-measuring on resize/scroll keeps a step
  // anchored through an orientation change or content shifting under it.
  //
  // The scroll is deliberately instant, not smooth. A smooth scroll runs for a browser-chosen
  // duration that grows with the distance travelled, and the scroll listener below re-measures
  // throughout it — so the spotlight spent a different amount of time chasing a moving target
  // on every step, and no time at all on a step that needed no scrolling. Resolving the scroll
  // first makes `rect` final before anything moves, leaving the CSS transition (`.tour-box`)
  // as the only motion: the same distance-independent glide on every step. The page jump
  // behind the dimming is barely visible — the eye is on the spotlight, which does move.
  useLayoutEffect(() => {
    if (!current) return;
    current.el.scrollIntoView({ block: "center", behavior: "auto" });
    function measure() {
      if (current) setRect(current.el.getBoundingClientRect());
    }
    measure();
    // A late correction for layout that settles after the first paint (a web font swapping in,
    // an image finally sizing itself). With the scroll already resolved this is insurance, not
    // the mechanism — it glides like any other change rather than snapping.
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
  //
  // Deliberately no scroll lock of its own, unlike `OverlayShell`. Two independent
  // save-and-restore locks on `document.body.style.overflow` corrupt each other: a step's
  // `autoOpen` opens a real Modal, whose `OverlayShell` saves the *current* value — already
  // `"hidden"`, because the tour set it — and restores that when it closes. The tour's own
  // cleanup runs first, putting the page back correctly, and the modal closing straight after
  // then re-applied `"hidden"` with nothing left to undo it: the page stayed unscrollable
  // after the tour ended. Nothing here needs the lock anyway — every background element is
  // already `inert`, so a scroll can't reach anything, and the spotlight re-measures on scroll
  // and stays glued to its target.
  useEffect(() => {
    if (!running) return;
    const marked: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement) || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      marked.push(child);
    }
    skipRef.current?.focus();
    return () => {
      for (const el of marked) el.removeAttribute("inert");
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
   * `alreadySeen: false`, picks up from there. Reaching the end of the list simply lets the
   * walkthrough run out.
   */
  /**
   * Put the page back as the tour found it. A step's `autoOpen` opens real UI — an Expenses
   * row's ⋮ menu, Line Items' "Manage" modal — and without this the tour ended leaving the user
   * holding a modal they never opened.
   *
   * Escape rather than clicking the opener again: `Menu` and `OverlayShell` both already close
   * on it, whereas a second click only re-opens a modal whose trigger isn't a toggle. Deferred
   * by a macrotask so the tour's own Escape listener — removed in the effect cleanup that this
   * same `setCurrent(null)` triggers — is gone before the key lands, otherwise the tour would
   * catch its own keypress and treat it as Skip, cancelling the rest of the walkthrough.
   */
  function closeAnythingOpened() {
    if (!openedRef.current) return;
    openedRef.current = false;
    window.setTimeout(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }, 0);
  }

  function finish(skipped: boolean) {
    setCurrent(null);
    closeAnythingOpened();
    void completeTourAction(tour);
    if (skipped) {
      try {
        sessionStorage.removeItem(TOUR_SEQUENCE_KEY);
      } catch {
        // Nothing to clean up if storage isn't available in the first place.
      }
      return;
    }
    continueTourSequence(tour, router);
  }

  /** Return to the previous step the user actually saw, skipping any that were dropped. */
  function goBack() {
    const { trail, index } = popShownStep(historyRef.current);
    if (index === undefined) return;
    historyRef.current = trail;
    setStepIndex(index);
  }

  if (!current || !rect || typeof document === "undefined") return null;

  // Counted over steps actually shown, not raw list positions: a tour whose conditional steps
  // didn't apply used to promise a total the user could never reach, and label its real last
  // card "Next" (review fix).
  const shownSoFar = historyRef.current.length;
  const isLast = remaining === 0;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const dockToBottom = viewportWidth < MOBILE_BREAKPOINT && rect.top < DOCK_THRESHOLD_TOP;

  const cardWidth = Math.min(340, viewportWidth - MARGIN * 2);
  // Neither above nor below has room for a whole card, but there is room beside the target:
  // put it there rather than on top of the very thing it is pointing at. A tall target on a
  // short viewport (the packet's "cannot be downloaded yet" panel on a laptop) passed the
  // "place below" test and was then clamped back up the screen by the fits-on-screen guard,
  // landing the card squarely over the alert it was describing. Only consulted when the
  // vertical placements genuinely don't fit, so every roomier case behaves exactly as before.
  const spacing = { gap: GAP, margin: MARGIN, cardHeight: ESTIMATED_CARD_HEIGHT };
  const beside = fitsVertically(rect, viewportHeight, spacing)
    ? null
    : sideRoom(rect, viewportWidth, cardWidth, spacing);
  let cardTop: number;
  let cardLeft: number;
  if (dockToBottom) {
    cardTop = viewportHeight - MARGIN; // positioned via bottom-anchored transform below
    cardLeft = viewportWidth / 2;
  } else if (beside) {
    cardLeft = beside === "right" ? rect.right + GAP : rect.left - GAP - cardWidth;
    // Centred on the target, then kept fully on screen.
    cardTop = clamp(
      rect.top + rect.height / 2 - ESTIMATED_CARD_HEIGHT / 2,
      MARGIN,
      Math.max(MARGIN, viewportHeight - ESTIMATED_CARD_HEIGHT - MARGIN),
    );
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
    <div
      className="tour-overlay fixed inset-0 z-[60]"
      data-tour-overlay
      role="region"
      aria-label="App guide"
    >
      {/* One rounded cutout, not four dark strips meeting at square corners: a strip has no
       *  way to round the hole it helps form, so the revealed area always came out a hard
       *  rectangle however round the ring inside it was. An outward box-shadow spread darkens
       *  everything outside this box instead, so the hole takes this element's own
       *  border-radius — and it's one element rather than four. The spread is large enough to
       *  cover any viewport; the overlay doesn't clip it. When the target is a just-
       *  `autoOpen`ed menu/panel, `rect` is that panel's own box (its `data-tour` sits on the
       *  panel, not the trigger — see `expenses-tour.ts`), so the hole lands around it rather
       *  than around the small trigger that opened it. */}
      <div
        className="tour-box pointer-events-none absolute"
        style={{
          top: rect.top - SPOTLIGHT_PAD,
          left: rect.left - SPOTLIGHT_PAD,
          width: rect.width + SPOTLIGHT_PAD * 2,
          height: rect.height + SPOTLIGHT_PAD * 2,
          borderRadius: SPOTLIGHT_RADIUS,
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)",
        }}
      />
      {/* Concentric with the cutout by construction — `SPOTLIGHT_RADIUS` is derived from this
       *  one plus the difference in inset, so the two curves stay parallel at any size. */}
      <div
        className="tour-box pointer-events-none absolute ring-2 ring-accent"
        style={{
          top: rect.top - RING_PAD,
          left: rect.left - RING_PAD,
          width: rect.width + RING_PAD * 2,
          height: rect.height + RING_PAD * 2,
          borderRadius: RING_RADIUS,
        }}
      />

      <div
        className={
          (dockToBottom
            ? "absolute -translate-x-1/2 -translate-y-full "
            : "absolute ") +
          "tour-box bg-surface border border-line rounded-[10px] shadow-2xl p-4 sm:p-5 " +
          "max-h-[calc(100dvh-24px)] overflow-y-auto"
        }
        style={{ top: cardTop, left: cardLeft, width: cardWidth }}
      >
        {/* The same eyebrow treatment section headings use elsewhere (line-items-manager,
            settings-sections), so the card reads as part of the app rather than a tooltip. */}
        <div className="text-[11px] uppercase tracking-[0.06em] font-bold text-sub mb-2">
          Step {shownSoFar} of {shownSoFar + remaining}
        </div>
        <div className="font-serif text-lg font-bold text-ink mb-1.5">{current.step.title}</div>
        <div className="text-[15px] text-ink leading-relaxed">{current.step.body}</div>
        {/* A hairline above the controls rather than bare space: at the narrow card width the
            body text and the buttons otherwise crowd into one block. */}
        <div className="flex items-center justify-between gap-3 mt-4 pt-3.5 border-t border-line">
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
            {shownSoFar > 1 && (
              <Button variant="secondary" onClick={goBack}>
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
