import type { ComponentProps, ReactNode } from "react";
import { useId } from "react";

import { cn } from "@/src/lib/cn";

/** Shared control chrome. Exported so the custom `Select` trigger matches Input/Textarea. */
export const CONTROL =
  "w-full min-h-11 px-3.5 py-3 text-base font-sans text-ink bg-surface " +
  "border border-line rounded-[3px] box-border " +
  // Read-only (a locked month's expense) must not look editable.
  "disabled:bg-section disabled:text-sub disabled:cursor-not-allowed " +
  // A control marked invalid (its own error under it) gets a red border.
  "aria-[invalid=true]:border-danger";

/** Field label — 15px semibold above the control, per the design system. */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn("block text-[15px] font-semibold mb-1.5 text-ink", className)}
      {...props}
    />
  );
}

/** Secondary helper text under a control. */
export function Helper({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-sm text-sub mt-1.5 leading-relaxed", className)} {...props} />;
}

/** Inline validation message. */
export function FieldError({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-[15px] text-danger leading-snug mt-2", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(CONTROL, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea className={cn(CONTROL, "leading-relaxed resize-y", className)} {...props} />
  );
}

// A Client Component of its own (hooks), so this file stays importable from Server Components
// (`app/r/feature-requests/page.tsx` renders `Input`). Re-exported so callers keep one import.
export { MoneyInput } from "./money-input";

/** `aria-invalid` and `aria-describedby` for a control whose error sits under it at `errorId`:
 *  the wiring `Field` gives its own control, for controls that can't sit in a `Field` (fixed ids
 *  the form focuses by, rows with no label of their own). Empty when there is no error. */
export function invalidProps(errorId: string, error: unknown) {
  return error ? { "aria-invalid": true as const, "aria-describedby": errorId } : {};
}

/** After a refused submit: focus the first marked control inside `root` and bring it to the
 *  middle of the screen, so a long form (or a phone) lands on what to fix. */
export function focusFirstInvalid(root: HTMLElement | null) {
  const first = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
  first?.focus({ preventScroll: true });
  first?.scrollIntoView({ block: "center" });
}

/**
 * Label + control + helper/error, wired together with a generated id so the label
 * is programmatically associated with its input. With an error the control also gets
 * `aria-invalid`, which gives it the red border (`Input`, `MoneyInput`).
 *
 * `id` fixes the id instead of generating one (a form that focuses fields by id); `labelAside`
 * sits at the end of the label row (a password's Show toggle).
 */
export function Field({
  label,
  helper,
  error,
  optional,
  children,
  className,
  id: fixedId,
  labelAside,
}: {
  label: string;
  helper?: ReactNode;
  error?: string;
  optional?: boolean;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
  className?: string;
  id?: string;
  labelAside?: ReactNode;
}) {
  const generatedId = useId();
  const id = fixedId ?? generatedId;
  const describedBy = error ? `${id}-error` : helper ? `${id}-helper` : undefined;
  const label_ = (
    <Label htmlFor={id}>
      {label}
      {optional && <span className="font-normal text-sub"> (optional)</span>}
    </Label>
  );

  return (
    <div className={className}>
      {labelAside ? (
        <div className="flex items-baseline justify-between gap-2">
          {label_}
          {labelAside}
        </div>
      ) : (
        label_
      )}
      {children({ id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true as const } : {}) })}
      {helper && !error && <Helper id={`${id}-helper`}>{helper}</Helper>}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}
