"use client";

import type { ReactNode } from "react";
import { useId, useRef } from "react";

import { OverlayShell } from "@/src/components/ui/overlay-shell";

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

  if (!open) return null;

  return (
    <OverlayShell open onDismiss={dismissDisabled ? () => {} : onClose} initialFocusRef={closeRef}>
      <div className={`w-full ${MODAL_WIDTH[size]} max-h-[calc(100dvh-2rem)] overflow-y-auto`}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="bg-surface border border-line rounded-[4px] p-4 sm:p-5 shadow-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div id={titleId} className="font-serif text-lg sm:text-xl font-bold text-ink">
              {title}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              disabled={dismissDisabled}
              aria-label="Close"
              className="text-muted hover:text-ink text-xl leading-none px-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              &times;
            </button>
          </div>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </OverlayShell>
  );
}
