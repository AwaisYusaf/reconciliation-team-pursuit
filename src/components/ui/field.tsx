import type { ComponentProps, ReactNode } from "react";
import { useId } from "react";

import { cn } from "@/src/lib/cn";

const CONTROL =
  "w-full min-h-11 px-3.5 py-3 text-base font-sans text-ink bg-surface " +
  "border border-line rounded-[3px] box-border";

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

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(CONTROL, "px-3 py-[11px]", className)} {...props} />;
}

/**
 * Money input — a bordered composite with a leading `$` and a right-aligned,
 * tabular-numeral field, matching the approved design. The value stays a string
 * here; parsing to integer cents happens server-side in the domain layer.
 */
export function MoneyInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 min-h-11 px-3 bg-surface border border-line rounded-[3px]",
        className,
      )}
    >
      <span className="text-base text-sub">$</span>
      <input
        inputMode="decimal"
        className="flex-1 min-w-0 border-none outline-none bg-transparent py-[11px] text-base text-ink text-right tabular-nums font-sans"
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
