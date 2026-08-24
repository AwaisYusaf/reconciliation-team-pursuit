"use client";

import type { ReactNode, Ref } from "react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/src/components/ui/button";

/**
 * A blocking confirm/cancel modal: a destructive action (delete, remove) the user must
 * explicitly confirm before it happens. Structured like `document-viewer.tsx` — a
 * portal-to-body overlay owning focus, Escape and scroll lock — but `DialogPanel` itself is
 * pure markup with no portal and no browser APIs, so it can be rendered (and tested) on the
 * server.
 */

export type DialogConfirm = { label: string; onConfirm: () => void; disabled?: boolean };

/**
 * The panel's visible content and buttons. No effects, no `document`/`window` access — this
 * is what makes it server-renderable, which is what `dialog.test.ts` relies on to check the
 * markup without a DOM.
 *
 * Styling copies `DangerPanel`'s `tone="blocking"` token classes rather than nesting the real
 * `DangerPanel` component, which hardcodes `role="alert"` — doubling that inside an
 * `alertdialog` would announce the content twice to a screen reader.
 */
export function DialogPanel({
  title,
  children,
  confirm,
  dismissLabel,
  onDismiss,
  dismissRef,
}: {
  title: string;
  children: ReactNode;
  confirm?: DialogConfirm;
  dismissLabel: string;
  onDismiss: () => void;
  dismissRef?: Ref<HTMLButtonElement>;
}) {
  const titleId = useId();
  const bodyId = useId();

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="bg-danger-bg text-danger border-2 border-danger rounded-[3px] p-4 sm:p-5 shadow-xl"
    >
      <div id={titleId} className="font-serif text-lg sm:text-xl font-bold text-danger">
        {title}
      </div>
      <div id={bodyId} className="text-[15px] leading-relaxed mt-2.5">
        {children}
      </div>
      <div className="flex flex-wrap gap-3 mt-4">
        {confirm ? (
          <>
            <Button variant="secondary" disabled={confirm.disabled} onClick={confirm.onConfirm}>
              {confirm.label}
            </Button>
            <Button variant="quiet" ref={dismissRef} onClick={onDismiss}>
              {dismissLabel}
            </Button>
          </>
        ) : (
          <Button variant="secondary" ref={dismissRef} onClick={onDismiss}>
            {dismissLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

function DialogOverlay({
  title,
  children,
  confirm,
  dismissLabel,
  onDismiss,
}: {
  title: string;
  children: ReactNode;
  confirm?: DialogConfirm;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  // The root of the portalled tree — the element `createPortal` actually appends to
  // `document.body`. Recorded so the `inert` pass below can recognise (and skip) it.
  const rootRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  // Focus is taken by the dialog, so it has to go back where it came from on close —
  // otherwise a keyboard user is returned to the top of the document.
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    // Always the dismiss button (Cancel/OK), never the destructive confirm — a stray
    // Enter must not fire the confirm action the instant the dialog opens.
    dismissRef.current?.focus();
    return () => returnFocusTo.current?.focus?.();
  }, []);

  // The page behind must not scroll while the dialog is up, on touch as well as wheel.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // Focus containment: everything behind the dialog becomes `inert` (unreachable by Tab or
  // a screen reader) for as long as it's open. Only the elements this effect itself marked
  // are recorded and cleared on cleanup — clearing `inert` everywhere would break a second,
  // already-open dialog if one ever stacks on top of another.
  useEffect(() => {
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
  }, []);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={(event) => {
        // Only the backdrop itself dismisses; a click that started on the panel must not.
        // Backdrop click is a dismissal, never a confirm.
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="w-full max-w-[480px] max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogPanel
          title={title}
          confirm={confirm}
          dismissLabel={dismissLabel}
          onDismiss={onDismiss}
          dismissRef={dismissRef}
        >
          {children}
        </DialogPanel>
      </div>
    </div>
  );
}

/**
 * Owns the portal. A portal because the dialog must escape whatever card, table cell or
 * stacking context it is opened from.
 */
export function Dialog({
  open,
  title = "Something went wrong",
  children,
  confirm,
  dismissLabel = "OK",
  onDismiss,
}: {
  open: boolean;
  title?: string;
  children: ReactNode;
  confirm?: DialogConfirm;
  dismissLabel?: string;
  onDismiss: () => void;
}) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <DialogOverlay title={title} confirm={confirm} dismissLabel={dismissLabel} onDismiss={onDismiss}>
      {children}
    </DialogOverlay>,
    document.body,
  );
}
