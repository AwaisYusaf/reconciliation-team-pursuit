"use client";

import type { ReactNode, Ref } from "react";
import { useId, useRef } from "react";

import { Button } from "@/src/components/ui/button";
import { OverlayShell } from "@/src/components/ui/overlay-shell";

/**
 * A blocking confirm/cancel modal: a destructive action (delete, remove) the user must
 * explicitly confirm before it happens. Structured like `document-viewer.tsx` — a
 * portal-to-body overlay owning focus, Escape and scroll lock — but `DialogPanel` itself is
 * pure markup with no portal and no browser APIs, so it can be rendered (and tested) on the
 * server.
 */

export type DialogConfirm = { label: string; onConfirm: () => void; disabled?: boolean };

/** `danger` (default) for destructive prompts. `neutral` for a consequential but ordinary step
 *  — locking or unlocking a month — that the red delete-warning treatment would overstate. */
export type DialogTone = "danger" | "neutral";

const TONE = {
  danger: {
    panel: "bg-danger-bg text-danger border-2 border-danger",
    title: "text-danger",
  },
  neutral: {
    panel: "bg-surface text-ink border border-line",
    title: "text-ink",
  },
} as const;

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
  dismissDisabled = false,
  tone = "danger",
}: {
  title: string;
  children: ReactNode;
  confirm?: DialogConfirm;
  dismissLabel: string;
  onDismiss: () => void;
  dismissRef?: Ref<HTMLButtonElement>;
  dismissDisabled?: boolean;
  tone?: DialogTone;
}) {
  const titleId = useId();
  const bodyId = useId();

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={`${TONE[tone].panel} rounded-[3px] p-4 sm:p-5 shadow-xl`}
    >
      <div id={titleId} className={`font-serif text-lg sm:text-xl font-bold ${TONE[tone].title}`}>
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
            <Button variant="quiet" ref={dismissRef} disabled={dismissDisabled} onClick={onDismiss}>
              {dismissLabel}
            </Button>
          </>
        ) : (
          <Button variant="secondary" ref={dismissRef} disabled={dismissDisabled} onClick={onDismiss}>
            {dismissLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/** `sm` (default) fits a confirm/cancel prompt. `lg` is for content with real width to it —
 *  a multi-column table, for instance — that `sm` would otherwise squeeze into a few narrow
 *  characters per line. */
const PANEL_WIDTH = { sm: "max-w-[480px]", lg: "max-w-[880px]" } as const;

function DialogOverlay({
  title,
  children,
  confirm,
  dismissLabel,
  onDismiss,
  size = "sm",
  dismissDisabled,
  tone,
}: {
  title: string;
  children: ReactNode;
  confirm?: DialogConfirm;
  dismissLabel: string;
  onDismiss: () => void;
  size?: keyof typeof PANEL_WIDTH;
  dismissDisabled?: boolean;
  tone?: DialogTone;
}) {
  // Always the dismiss button (Cancel/OK), never the destructive confirm — a stray Enter
  // must not fire the confirm action the instant the dialog opens.
  const dismissRef = useRef<HTMLButtonElement>(null);
  // Escape and the backdrop route through the same handler, so a disabled dismiss blocks
  // those too — not only the button.
  const dismiss = () => {
    if (!dismissDisabled) onDismiss();
  };

  return (
    <OverlayShell open onDismiss={dismiss} initialFocusRef={dismissRef}>
      <div className={`w-full ${PANEL_WIDTH[size]} max-h-[calc(100dvh-2rem)] overflow-y-auto`}>
        <DialogPanel
          title={title}
          confirm={confirm}
          dismissLabel={dismissLabel}
          onDismiss={dismiss}
          dismissRef={dismissRef}
          dismissDisabled={dismissDisabled}
          tone={tone}
        >
          {children}
        </DialogPanel>
      </div>
    </OverlayShell>
  );
}

export function Dialog({
  open,
  title = "Something went wrong",
  children,
  confirm,
  dismissLabel = "OK",
  onDismiss,
  size,
  dismissDisabled,
  tone,
}: {
  open: boolean;
  title?: string;
  children: ReactNode;
  confirm?: DialogConfirm;
  dismissLabel?: string;
  onDismiss: () => void;
  size?: keyof typeof PANEL_WIDTH;
  /** Blocks Cancel, Escape and the backdrop — for while the confirm's request is in flight
   *  and closing would claim nothing happened when something still will. */
  dismissDisabled?: boolean;
  tone?: DialogTone;
}) {
  // `OverlayShell` (inside `DialogOverlay`) owns the portal and the open/SSR gating.
  if (!open) return null;

  return (
    <DialogOverlay
      title={title}
      confirm={confirm}
      dismissLabel={dismissLabel}
      onDismiss={onDismiss}
      size={size}
      dismissDisabled={dismissDisabled}
      tone={tone}
    >
      {children}
    </DialogOverlay>
  );
}
