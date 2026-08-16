"use client";

import { Toaster, toast as hotToast } from "react-hot-toast";

import type { ActionResult } from "@/src/lib/action-result";

/**
 * Transient action feedback.
 *
 * Toasts report the outcome of an action the user just took — saved, removed, failed.
 * They never replace inline field errors, which belong beside the field they describe, nor
 * the blocking panels, which must persist because they describe a state rather than an
 * event.
 */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      toastOptions={{
        duration: 4000,
        style: {
          background: "var(--color-surface)",
          color: "var(--color-ink)",
          border: "1px solid var(--color-line)",
          borderRadius: "3px",
          fontFamily: "var(--font-sans)",
          fontSize: "15px",
          padding: "12px 16px",
          maxWidth: "520px",
        },
        success: { iconTheme: { primary: "var(--color-success)", secondary: "#fff" } },
        error: {
          duration: 6000,
          iconTheme: { primary: "var(--color-danger)", secondary: "#fff" },
        },
      }}
    />
  );
}

export const toast = {
  success: (message: string) => hotToast.success(message),
  error: (message: string) => hotToast.error(message),
  /** For a slow action; returns the id so the caller can resolve it. */
  loading: (message: string) => hotToast.loading(message),
  dismiss: (id?: string) => hotToast.dismiss(id),
};

/**
 * Report an ActionResult: success message on success, the action's own error on failure.
 *
 * Declared as a type guard so callers keep the union narrowed in the `else` branch and can
 * still read `result.error` without re-checking `ok`.
 */
export function reportResult<T>(
  result: ActionResult<T>,
  successMessage?: string,
): result is { ok: true; data: T } {
  if (result.ok) {
    if (successMessage) toast.success(successMessage);
    return true;
  }
  toast.error(result.error);
  return false;
}
