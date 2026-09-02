"use client";

import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";

import { Button } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";

/**
 * A button whose action is destructive, so it asks first.
 *
 * Exists because the asking was the part that kept being skipped. Removing an attached
 * receipt deleted the row, the stored file and its thumbnail on the first click, with the
 * risk answered by a line of helper text rather than a question — and the client destroyed a
 * document by misclicking exactly that. Several other controls destroyed stored records the
 * same way, while their siblings raised a dialog: the pattern existed and was applied by hand,
 * which is the same reason every other defect in this project shipped.
 *
 * Wrapping the pair means a destructive control cannot be added without the question, and
 * every one of them phrases, focuses and dismisses itself identically.
 *
 * Only for actions that destroy something stored. Discarding unsaved typing — Cancel, or
 * switching which row is being edited — is not this: a dialog on every cancel trains people to
 * dismiss dialogs without reading them, which is what makes the real ones stop working.
 */
export function ConfirmButton({
  title,
  body,
  confirmLabel,
  dismissLabel = "Keep it",
  onConfirm,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick"> & {
  /** The question, e.g. "Remove this file?" — a question, so the two buttons are answers. */
  title: string;
  /** What is lost. Name the thing: a filename, an amount, a count of what goes with it. */
  body: ReactNode;
  /** The destructive answer, e.g. "Remove file" — never "OK", which says nothing. */
  confirmLabel: string;
  /** The safe answer. Defaults to the wording already used across the app. */
  dismissLabel?: string;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);

  return (
    <>
      <Button {...props} onClick={() => setAsking(true)}>
        {children}
      </Button>

      <Dialog
        open={asking}
        title={title}
        dismissLabel={dismissLabel}
        onDismiss={() => setAsking(false)}
        confirm={{
          label: confirmLabel,
          // Closing first keeps the dialog from lingering over whatever the action navigates
          // to or refreshes; the callers report their own failures through the toast.
          onConfirm: () => {
            setAsking(false);
            onConfirm();
          },
        }}
      >
        {body}
      </Dialog>
    </>
  );
}
