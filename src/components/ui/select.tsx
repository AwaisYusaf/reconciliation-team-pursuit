"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Children, isValidElement, useEffect, useId, useRef, useState } from "react";

import { CONTROL } from "@/src/components/ui/field";
import { cn } from "@/src/lib/cn";

type Option = { value: string; label: string; disabled?: boolean };

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/**
 * Flatten `<option>` children — including ones produced by `.map()` or wrapped in
 * fragments — into plain option data. An option with no `value` attribute falls back to
 * its text (e.g. `<option>{ALL_LINE_ITEMS}</option>`), matching native `<select>` behaviour.
 */
export function optionsFromChildren(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child): Option[] => {
    if (!isValidElement(child) || child.type !== "option") return [];
    const props = child.props as { value?: string; disabled?: boolean; children?: ReactNode };
    const label = textOf(props.children);
    return [{ value: props.value ?? label, label, disabled: props.disabled }];
  });
}

type SelectProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
  name?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
};

/**
 * Hand-rolled accessible listbox dropdown — keeps `<option>` children so existing call
 * sites barely change, without pulling in a headless-UI dependency.
 */
export function Select({
  value,
  defaultValue,
  onValueChange,
  children,
  name,
  id,
  disabled,
  required,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: SelectProps) {
  const options = optionsFromChildren(children);
  // Matches native <select>: with no explicit value/defaultValue, the first option is what's
  // actually selected (and submitted), not just what happens to be displayed.
  const [internalValue, setInternalValue] = useState(defaultValue ?? options[0]?.value ?? "");
  const currentValue = value !== undefined ? value : internalValue;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openUpward, setOpenUpward] = useState(false);

  const listboxId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  const selectedIndex = options.findIndex((option) => option.value === currentValue);
  const displayOption = selectedIndex >= 0 ? options[selectedIndex] : options[0];

  function commit(next: string) {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  }

  function firstEnabledIndex() {
    const index = options.findIndex((option) => !option.disabled);
    return index === -1 ? 0 : index;
  }

  function lastEnabledIndex() {
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (!options[index].disabled) return index;
    }
    return options.length - 1;
  }

  function moveActive(delta: number) {
    setActiveIndex((current) => {
      let next = current;
      for (let step = 0; step < options.length; step += 1) {
        next = (next + delta + options.length) % options.length;
        if (!options[next].disabled) return next;
      }
      return current;
    });
  }

  function openPanel() {
    if (disabled || options.length === 0) return;
    setActiveIndex(selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : firstEnabledIndex());
    setOpen(true);
  }

  function closePanel(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function selectAt(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    commit(option.value);
    closePanel();
  }

  // Viewport-aware positioning: flip above the trigger when there isn't room below.
  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setOpenUpward(spaceBelow < 240 && spaceAbove > spaceBelow);
  }, [open]);

  // Click-outside closes, without stealing focus from whatever was clicked.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) closePanel(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (!open) {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openPanel();
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(firstEnabledIndex());
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(lastEnabledIndex());
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectAt(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        closePanel();
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  }

  const activeId = open && options[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-required={required}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        onClick={() => (open ? closePanel() : openPanel())}
        onKeyDown={onKeyDown}
        className={cn(
          CONTROL,
          "px-3 py-[11px] flex items-center justify-between gap-2 text-left disabled:opacity-60",
        )}
      >
        <span className="truncate">{displayOption?.label ?? ""}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4 flex-none text-sub">
          <path
            d="M5.25 7.5l4.75 5 4.75-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Keeps `formData.get(name)` working. A `type="hidden"` input is barred from constraint
          validation entirely, which would make `required` silently do nothing, so a required
          Select instead submits through a visually-hidden (not `hidden`-type) text input —
          `sr-only` rather than `readonly`, since `readonly` is *also* barred from constraint
          validation. `tabIndex={-1}` and the lack of any visible affordance keep it out of the
          tab order and unreachable by mouse; the trigger button owns all real interaction. */}
      {name &&
        (required ? (
          <input
            type="text"
            name={name}
            value={currentValue}
            required
            aria-hidden="true"
            tabIndex={-1}
            className="sr-only"
            onChange={() => {}}
          />
        ) : (
          <input type="hidden" name={name} value={currentValue} />
        ))}

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            "absolute z-20 left-0 right-0 max-h-[min(320px,60vh)] overflow-y-auto",
            "bg-surface border border-line rounded-[3px]",
            openUpward ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {options.map((option, index) => {
            const isSelected = option.value === currentValue;
            const isActive = index === activeIndex;
            return (
              <div
                key={option.value + "-" + index}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                onClick={() => selectAt(index)}
                onPointerEnter={() => !option.disabled && setActiveIndex(index)}
                className={cn(
                  "min-h-11 flex items-center px-3.5 text-base text-ink",
                  option.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                  isActive && !option.disabled && "bg-section",
                  isSelected && "text-accent font-semibold",
                )}
              >
                {option.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
