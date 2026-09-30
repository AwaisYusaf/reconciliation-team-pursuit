"use client";

import type { ComponentProps } from "react";
import { useLayoutEffect, useRef } from "react";

import { sanitiseMoneyInput, ungroupEdit } from "@/src/domain/money";
import { cn } from "@/src/lib/cn";

/**
 * Money input — a bordered composite with a leading `$` and a right-aligned,
 * tabular-numeral field, matching the approved design. The value stays a string
 * here; parsing to integer cents happens server-side in the domain layer.
 */
export function MoneyInput({ className, onChange, ref, ...props }: ComponentProps<"input">) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** The box's value before the next edit, for `ungroupEdit`: refreshed after every render (a
   *  saved figure, a fill such as vendor autofill) and after every edit here. */
  const previous = useRef("");
  useLayoutEffect(() => {
    if (inputRef.current) previous.current = inputRef.current.value;
  });

  return (
    <div
      className={cn(
        // `money-field`: the focus ring goes on this box, not the inner input (globals.css).
        "money-field flex items-center gap-1.5 min-h-11 px-3 bg-surface border border-line rounded-[3px] has-[:disabled]:bg-section has-[[aria-invalid=true]]:border-danger",
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
          // `sanitiseMoneyInput` is a left-to-right fold whose state depends only on the text so
          // far, so sanitising the prefix before the caret gives exactly where the caret goes.
          //
          // Then an edit of a grouped figure ("20,000.00") drops the grouping, so it can never
          // leave "20,00", which the decimal-comma rule reads as $20.00 (PR #27, `ungroupEdit`).
          // Nothing happens on focus or select: only an edit changes the box.
          const input = event.currentTarget;
          const caret = input.selectionStart ?? input.value.length;
          const next = ungroupEdit(
            previous.current,
            sanitiseMoneyInput(input.value),
            sanitiseMoneyInput(input.value.slice(0, caret)).length,
          );
          if (next.value !== input.value) {
            input.value = next.value;
            input.setSelectionRange(next.caret, next.caret);
          }
          previous.current = next.value;
          onChange?.(event);
        }}
        className="flex-1 min-w-0 border-none outline-none bg-transparent py-[11px] text-base text-ink text-right tabular-nums font-sans disabled:text-sub disabled:cursor-not-allowed"
        {...props}
        ref={(node) => {
          inputRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
      />
    </div>
  );
}
