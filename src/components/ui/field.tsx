import type { ComponentProps, ReactNode } from "react";
import { useId } from "react";

import { sanitiseMoneyInput } from "@/src/domain/money";
import { cn } from "@/src/lib/cn";

/** Shared control chrome. Exported so the custom `Select` trigger matches Input/Textarea. */
export const CONTROL =
  "w-full min-h-11 px-3.5 py-3 text-base font-sans text-ink bg-surface " +
  "border border-line rounded-[3px] box-border " +
  // Read-only (a locked month's expense) must not look editable.
  "disabled:bg-section disabled:text-sub disabled:cursor-not-allowed";

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

/**
 * Money input — a bordered composite with a leading `$` and a right-aligned,
 * tabular-numeral field, matching the approved design. The value stays a string
 * here; parsing to integer cents happens server-side in the domain layer.
 */
export function MoneyInput({ className, onChange, ...props }: ComponentProps<"input">) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 min-h-11 px-3 bg-surface border border-line rounded-[3px] has-[:disabled]:bg-section",
        className,
      )}
    >
      <span className="text-base text-sub">$</span>
      <input
        inputMode="decimal"
        onChange={(event) => {
          // Filter the value rather than the keystroke, so paste, autofill and dictation are
          // covered too. `inputMode` alone is only a soft keyboard hint — on a desktop keyboard
          // it stops nothing, which is how letters were reaching the parser and saving $0.00.
          const input = event.currentTarget;
          const clean = sanitiseMoneyInput(input.value);

          if (clean !== input.value) {
            // Keep the caret where the user left it instead of flinging it to the end.
            // `sanitiseMoneyInput` is a left-to-right fold whose state depends only on the
            // text so far, so sanitising the prefix gives exactly the prefix of the result.
            const caret = input.selectionStart ?? input.value.length;
            const kept = sanitiseMoneyInput(input.value.slice(0, caret)).length;
            input.value = clean;
            input.setSelectionRange(kept, kept);
          }

          onChange?.(event);
        }}
        className="flex-1 min-w-0 border-none outline-none bg-transparent py-[11px] text-base text-ink text-right tabular-nums font-sans disabled:text-sub disabled:cursor-not-allowed"
        {...props}
      />
    </div>
  );
}

/**
 * Label + control + helper/error, wired together with a generated id so the label
 * is programmatically associated with its input.
 */
export function Field({
  label,
  helper,
  error,
  optional,
  children,
  className,
}: {
  label: string;
  helper?: ReactNode;
  error?: string;
  optional?: boolean;
  children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : helper ? `${id}-helper` : undefined;

  return (
    <div className={className}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-sub"> (optional)</span>}
      </Label>
      {children({ id, "aria-describedby": describedBy })}
      {helper && !error && <Helper id={`${id}-helper`}>{helper}</Helper>}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}
