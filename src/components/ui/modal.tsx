"use client";

import type { ReactNode } from "react";
import { useId, useRef } from "react";

import { OverlayShell, useOverlayPresence } from "@/src/components/ui/overlay-shell";
import { GRADIENT_TEXT } from "@/src/components/ui/surfaces";
import { cn } from "@/src/lib/cn";

/**
 * A neutral popup — a form or a list the user opens deliberately, as opposed to `Dialog`
 * (`dialog.tsx`), which is exclusively for a destructive action's confirm/cancel prompt and
 * hardcodes `role="alertdialog"` and danger-red styling for that reason. Every existing
 * `Dialog` call site is a delete/remove confirmation; this is for everything else that needs
 * a portal-and-focus-trapped overlay — first use is m08's "Add performance" popup.
 *
 * Shares its portal/focus/Escape/scroll-lock mechanics with `Dialog` via `OverlayShell`, but
 * has free-form `children` rather than a fixed confirm/dismiss button pair, since a form popup's
 * footer isn't one shape.
 */
/** `md` (default) matches a form or a short list. `lg` is for content with real width to it —
 *  a multi-column table, for instance — mirroring `Dialog`'s own `size` prop. */
const MODAL_WIDTH = { md: "max-w-[480px]", lg: "max-w-[880px]" } as const;

export function Modal({
  open,
  title,
  onClose,
  children,
  size = "md",
  dismissDisabled = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: keyof typeof MODAL_WIDTH;
  /** Holds the popup open — no ×, Escape or backdrop — while work it started is still running,
   *  as `Dialog`'s prop of the same name does. */
  dismissDisabled?: boolean;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  // Stays on screen, showing what it last showed, while it fades out.
  const { mounted, closing, shown } = useOverlayPresence(open, { title, children, size });

  if (!mounted) return null;

  return (
    <OverlayShell open onDismiss={dismissDisabled ? () => {} : onClose} initialFocusRef={closeRef} closing={closing}>
      <div className={`w-full ${MODAL_WIDTH[shown.size]} max-h-[calc(100dvh-2rem)] overflow-y-auto`}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          // 14px, a step above the 12px `HeroCard` — a panel floating over the page reads as
          // rounder than one sitting on it. This was 4px, the radius the rest of the app has
          // already moved off.
          // No `overflow-hidden`, deliberately. Nothing inside paints to the panel's edge —
          // the header and body are transparent over this one `bg-surface` — so clipping buys
          // no corner and costs the dropdowns: a `Select` inside a modal (the staff Change
          // plan screen has two) renders its panel absolutely inside this box, and clipping
          // cut it off at the edge with no way to scroll it back into view.
          className="bg-surface border border-line rounded-[14px] shadow-xl pop-in"
        >
          {/*
            A hairline under the title, and nothing else. The header was a washed band, which
            on a small white panel reads as a beige stripe across the top rather than as
            structure — the rule alone does the same job and lets the panel stay one surface.
          */}
          <div
            className={cn(
              "flex items-start justify-between gap-3 px-5 sm:px-6 pt-4 sm:pt-5 pb-3.5",
              "border-b border-line",
            )}
          >
            <div id={titleId} className="font-serif text-lg sm:text-xl font-bold min-w-0">
              <span className={GRADIENT_TEXT}>{shown.title}</span>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              disabled={dismissDisabled}
              aria-label="Close"
              className={cn(
                // A round target rather than a bare glyph: at `px-1` the old one was about
                // 10px wide, which is a hard thing to hit and reads as punctuation.
                "shrink-0 -mr-1 flex items-center justify-center w-8 h-8 rounded-full",
                "text-sub transition-colors hover:bg-section hover:text-ink",
                "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
              )}
            >
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className="w-[15px] h-[15px]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              >
                <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
              </svg>
            </button>
          </div>
          {/* Matching the header's side padding, and more of it than the old 16px — a form
              pressed against the panel edge is what made this feel cramped. */}
          <div className="px-5 sm:px-6 py-5">{shown.children}</div>
        </div>
      </div>
    </OverlayShell>
  );
}
