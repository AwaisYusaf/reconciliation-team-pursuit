"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** How long a closing overlay stays on screen to fade out; matches `.overlay-backdrop[data-closing]`
 *  in globals.css. Under a quarter second, per the motion rules there. */
export const OVERLAY_EXIT_MS = 160;

/** Where an overlay is in its open/close cycle: see `nextPresence`. */
export type Presence = {
  /** The `open` this state was last computed for. */
  open: boolean;
  /** Closed, but still on screen for its fade-out. */
  closing: boolean;
  /** How many times it has opened: a `key` that gives each opening a fresh component. */
  opens: number;
};

export function initialPresence(open: boolean): Presence {
  return { open, closing: false, opens: open ? 1 : 0 };
}

/**
 * The next state when `open` may have changed. Pure, so the cycle is tested without a DOM.
 * Closing starts the fade; opening again, even mid-fade, ends it and counts a new opening.
 */
export function nextPresence(state: Presence, open: boolean): Presence {
  if (open === state.open) return state;
  return { open, closing: !open, opens: open ? state.opens + 1 : state.opens };
}

/**
 * Keeps an overlay mounted for its closing animation. `open` going false leaves it `closing`
 * for `OVERLAY_EXIT_MS`, then unmounted. `snapshot` is what the overlay showed while open,
 * handed back unchanged while it fades: callers often clear their state in the same click that
 * closes (a quote set to null, say), and without this the panel would go blank mid-fade.
 *
 * `key` changes each time it opens. A parent that renders a popup with state of its own only
 * while something is set (`{x && <SharePopup/>}`) keeps it mounted through the fade with
 * `mounted`, and gives it `key` so the next opening starts fresh rather than where it left off.
 *
 * While closing, `OverlayShell` has already released the page (scroll, `inert`, Escape) and
 * made the fading overlay itself `inert`, so with reduce-motion set (the CSS ends the animation
 * at once) nothing is left behind that the page or the keyboard could trip over.
 */
export function useOverlayPresence<T>(
  open: boolean,
  snapshot: T,
): { mounted: boolean; closing: boolean; shown: T; key: number } {
  const [presence, setPresence] = useState(() => initialPresence(open));
  // The last snapshot an open render committed. Written after commit, so the render that
  // closes still reads the previous (open) one.
  const lastOpen = useRef(snapshot);
  // Adjusting state while rendering when `open` changes (React's documented pattern for a prop
  // change), so the frame that closes is already the closing frame.
  const next = nextPresence(presence, open);
  if (next !== presence) setPresence(next);

  useEffect(() => {
    if (open) lastOpen.current = snapshot;
  });

  const { closing } = next;
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setPresence((current) => ({ ...current, closing: false })), OVERLAY_EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  return {
    mounted: open || closing,
    closing,
    // eslint-disable-next-line react-hooks/refs -- read only while closing, after the open render committed it
    shown: open ? snapshot : lastOpen.current,
    key: next.opens,
  };
}

/**
 * Which open overlays exist, oldest first — the last entry is whichever is stacked on top
 * (a `ConfirmButton`'s Dialog opened from inside an already-open Modal, say). Module-level,
 * not state: every overlay on the page shares one stack regardless of which component tree
 * it portals from.
 */
const openStack: string[] = [];

/**
 * The portal/focus/Escape/scroll-lock mechanics shared by every full-screen overlay
 * (`Dialog`'s confirm/cancel modal, and `Modal`'s neutral popup) — pulled out so this
 * accessibility-sensitive code exists in exactly one place rather than being copied per
 * overlay and drifting.
 *
 * A portal because the overlay must escape whatever card, table cell or stacking context it
 * is opened from. `initialFocusRef` picks what receives focus on open — the dialog's dismiss
 * button, or the first field of a form popup — and always gets focus back on close, so a
 * keyboard user isn't dropped at the top of the document.
 */
export function OverlayShell({
  open,
  onDismiss,
  initialFocusRef,
  children,
  closing = false,
}: {
  open: boolean;
  onDismiss: () => void;
  initialFocusRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Fading out (`useOverlayPresence`): drawn, but inert, and no longer holding the page. */
  closing?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const id = useId();
  // Everything that holds the page (focus, `inert`, the scroll lock, the stack, Escape) lasts
  // while the overlay is open and not fading, so it is let go in the same commit that starts the
  // fade. React runs every effect cleanup of a commit before any new effect, so an overlay opened
  // by the same click (Continue on one dialog opening the Share popup, say) finds the page as it
  // was, not locked by the one fading away. Held through the fade instead, the second overlay
  // recorded "hidden" as the page's own overflow and restored it when it closed: the page then
  // couldn't scroll until a reload.
  const active = open && !closing;

  // Focus and containment in one effect, because their order matters both ways. Opening: note
  // what had focus before the page goes inert (a focused element that turns inert loses focus).
  // Closing: make the page live again before handing focus back, or the browser ignores focus()
  // on a still-inert trigger and the keyboard user lands on <body>. Everything behind the overlay
  // becomes `inert` (unreachable by Tab or a screen reader); only the elements marked here are
  // cleared on cleanup, since clearing `inert` everywhere would break a second overlay stacked on
  // this one.
  useEffect(() => {
    if (!active) return;
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    const root = rootRef.current;
    const marked: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      // `data-tour-overlay`: the app-guide tour (`tour.tsx`) can open a Modal itself mid-step
      // (Line Items' "Manage" panel, via `autoOpen` — D-95) while its own portal is *already*
      // an existing `document.body` child by the time this runs. Without this exemption, a
      // Modal opened that way would inert the tour's own card out from under itself, making
      // its Skip/Back/Done unresponsive — two independent "quarantine everything else but me"
      // systems, each unaware of the other.
      if (child === root || child.hasAttribute("inert") || child.hasAttribute("data-tour-overlay")) {
        continue;
      }
      child.setAttribute("inert", "");
      marked.push(child);
    }
    initialFocusRef.current?.focus();
    return () => {
      for (const element of marked) element.removeAttribute("inert");
      returnFocusTo.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);

  // Tracks stacking order so a nested overlay (a ConfirmButton's Dialog opened from inside
  // this Modal, say) knows whether it is the topmost one currently open. A fading overlay has
  // left the stack, so the one underneath answers the next Escape.
  useEffect(() => {
    if (!active) return;
    openStack.push(id);
    return () => {
      const index = openStack.indexOf(id);
      if (index !== -1) openStack.splice(index, 1);
    };
  }, [active, id]);

  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Only the topmost overlay answers Escape — otherwise both this instance's listener
      // and an overlay stacked underneath it would fire for the same keypress, dismissing
      // the one behind it too.
      if (openStack[openStack.length - 1] !== id) return;
      event.preventDefault();
      onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onDismiss, id]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={rootRef}
      // `overlay-backdrop` fades the dim in and out and animates the panel (globals.css).
      className="overlay-backdrop fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto"
      data-closing={closing ? "" : undefined}
      // Fading out answers nothing: no pointer (the CSS) and no keyboard. Without this the
      // confirm button kept focus and stayed enabled for the fade, so a second Enter ran a
      // ConfirmButton's action twice (it closes first, then acts). Inert also moves focus out.
      inert={closing}
      onClick={(event) => {
        // Only the backdrop itself dismisses; a click that started on the panel must not.
        if (event.target === event.currentTarget && !closing) onDismiss();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
