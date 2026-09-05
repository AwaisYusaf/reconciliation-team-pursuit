"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

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
}: {
  open: boolean;
  onDismiss: () => void;
  initialFocusRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    initialFocusRef.current?.focus();
    return () => returnFocusTo.current?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  // Focus containment: everything behind the overlay becomes `inert` (unreachable by Tab or
  // a screen reader) for as long as it's open. Only the elements this effect itself marked
  // are recorded and cleared on cleanup — clearing `inert` everywhere would break a second,
  // already-open overlay if one ever stacks on top of another.
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const marked: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child === root || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      marked.push(child);
    }
    return () => {
      for (const element of marked) element.removeAttribute("inert");
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={(event) => {
        // Only the backdrop itself dismisses; a click that started on the panel must not.
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
