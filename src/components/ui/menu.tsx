"use client";

/**
 * A small anchored popup menu — a short list of actions opened from a trigger (a "⋮"
 * button, typically), not a form or a page of content. Portaled to `document.body` and
 * positioned from the trigger's own `getBoundingClientRect()` so it isn't clipped by a
 * scrolling ancestor — a table's `overflow-x-auto`, in particular, which is exactly what
 * ruled out a simple `position: relative` + `absolute` panel like `Select` uses for its own
 * dropdown (a listbox, not this kind of menu, and not opened from inside a scrolling table).
 *
 * Deliberately not built on `OverlayShell`: that shared portal owns backdrop dimming, a full
 * focus trap and `inert`-ing the rest of the page, which is right for `Dialog`/`Modal` but
 * wrong here — a menu of a few actions shouldn't darken the screen or block interaction with
 * anything else on it.
 *
 * Keyboard and screen-reader behaviour is the part a portaled menu has to supply itself, since
 * the panel's position in the DOM is nowhere near its trigger: items are real `menuitem`s taken
 * out of the tab sequence, focus enters the panel on open, Arrow/Home/End move within it, and
 * Escape or Tab closes it and hands focus back to the trigger.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/src/lib/cn";

/**
 * Shared row styling for both button and link menu items, so they read as one list.
 *
 * `focus:bg-section` rather than only a `focus-visible` ring: arrow-key navigation moves focus
 * programmatically, where `:focus-visible` is browser-heuristic and may not match — a keyboard
 * user must always be able to see which item they are on. The ring is layered on top for when
 * it does match.
 */
const ITEM_CLASS =
  "block w-full min-h-11 flex items-center px-3.5 text-[15px] text-ink text-left hover:bg-section focus:bg-section focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent";

/**
 * `role="menuitem"` and `tabIndex={-1}`, on both item kinds.
 *
 * Required, not decorative: a `role="menu"` container whose children aren't menuitems is
 * announced by a screen reader as an empty menu. `tabIndex={-1}` takes the items out of the
 * tab sequence so the menu is driven by arrow keys (`Menu` below moves focus), which is what
 * the menu role promises — and it also stops Tab from walking into a panel that is portaled
 * to the end of `<body>`, far from the trigger it belongs to.
 */
export function MenuItem({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={cn(ITEM_CLASS, className)}
      {...props}
    />
  );
}

export function MenuLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link role="menuitem" tabIndex={-1} className={cn(ITEM_CLASS, className)} {...props} />;
}

/** Space (px) to check for below the trigger before flipping the panel above it instead. */
const FLIP_THRESHOLD = 160;

/**
 * The ⋮ trigger's own look: a quiet glyph that darkens on hover, with a visible focus ring.
 *
 * A default rather than something each caller passes. It was neither — the expenses table and
 * the drafts list each carried an identical copy of this string, and every other `Menu` in the
 * app got an unstyled browser button, so the users table's ⋮ sat there at default font size
 * with no hover and no focus ring. A shared control's ordinary appearance belongs to the
 * control; `triggerClassName` stays for the caller that genuinely needs a different one.
 */
const TRIGGER_CLASS =
  "px-2 py-2.5 text-lg leading-none text-sub hover:text-ink rounded-[2px] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

export function Menu({
  label,
  triggerClassName,
  triggerDataTour,
  panelDataTour,
  children,
}: {
  /** Accessible name for the trigger button — the row/item this menu acts on. */
  label: string;
  /** Overrides `TRIGGER_CLASS` for a caller that needs a different-looking trigger. */
  triggerClassName?: string;
  /** `data-tour` anchor for the trigger — what a tour step's `autoOpen` clicks to pop the
   *  menu open (Phase 7, D-95). */
  triggerDataTour?: string;
  /** `data-tour` anchor for the opened panel itself — the tour then spotlights *this*, not the
   *  small trigger button, so the cutout lands around the actual menu items. */
  panelDataTour?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number; openUpward: boolean } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  /**
   * Whether this open came from the keyboard, which decides if focus moves into the panel.
   *
   * A keyboard user needs to land on an item — there is no pointer to aim with. A mouse user
   * must NOT: highlighting the first item makes it look pre-selected, as if Enter would fire
   * it. Arrow keys still work either way; on a mouse open they pick the first item up from
   * the trigger, because `moveFocus` treats "focus is outside the list" as "start at the end
   * you are heading from".
   */
  const openedByKeyboard = useRef(false);

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < FLIP_THRESHOLD && rect.top > spaceBelow;
    // Right-aligned to the trigger's right edge — this app's row menus sit in the table's
    // last (sticky-end) column, where a left-aligned panel would run off the viewport edge.
    setPosition({
      top: openUpward ? window.innerHeight - rect.top : rect.bottom,
      right: window.innerWidth - rect.right,
      openUpward,
    });
    setOpen(true);
  }

  function close(returnFocus = false) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  /** The focusable items, in render order. Disabled buttons are skipped — arrowing onto one
   *  would park focus somewhere nothing happens. Read from the DOM rather than tracked in
   *  state, since `children` is opaque here and an item's `disabled` can change at any time. */
  const items = useCallback((): HTMLElement[] => {
    const found = panelRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled])',
    );
    return found ? Array.from(found) : [];
  }, []);

  /** Moves focus by `step`, wrapping, or to the first/last item when nothing is focused yet. */
  const moveFocus = useCallback(
    (step: 1 | -1) => {
      const list = items();
      if (list.length === 0) return;
      const current = list.indexOf(document.activeElement as HTMLElement);
      const next =
        current === -1
          ? step === 1
            ? 0
            : list.length - 1
          : (current + step + list.length) % list.length;
      list[next]?.focus();
    },
    [items],
  );

  // Focus the first item as the menu opens, so a keyboard user lands inside it rather than
  // having to hunt for a panel that lives at the end of `<body>`. Keyboard opens only — see
  // `openedByKeyboard`.
  useEffect(() => {
    if (!open || !openedByKeyboard.current) return;
    items()[0]?.focus();
  }, [open, items]);

  // Click-outside and Escape close it; a resize or scroll closes it too rather than tracking
  // position live — this is a handful of short-lived action items, not worth a scroll
  // listener kept alive for.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close(true);
        return;
      }
      // The arrow/Home/End set a `role="menu"` is expected to answer to. `preventDefault`
      // because these otherwise scroll the page behind the open menu.
      const steps: Record<string, 1 | -1> = { ArrowDown: 1, ArrowUp: -1 };
      if (event.key in steps) {
        event.preventDefault();
        moveFocus(steps[event.key]);
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const list = items();
        (event.key === "Home" ? list[0] : list[list.length - 1])?.focus();
        return;
      }
      // Tab closes rather than escaping into the portal's document position, and lets the
      // browser carry on from the trigger — the place the user actually came from.
      if (event.key === "Tab") close(true);
    }
    function onViewportChange() {
      close();
    }

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
    // `items`/`moveFocus` are `useCallback`-stable, so listing them re-runs nothing extra.
  }, [open, items, moveFocus]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // `detail === 0` means the click came from Enter/Space on the focused button rather
        // than a pointer — the browser reports no click count for a synthesised one. That is
        // the signal for whether to move focus into the panel.
        //
        // `isTrusted` as well: a script's `.click()` also reports `detail === 0`, and was being
        // read as a keyboard open. The app guide opens a row's menu that way (`autoOpen`), so
        // focus jumped onto "Edit" mid-tour — pressing Enter to continue the tour opened the
        // expense instead, and ArrowDown + Enter reached Delete (review fix). A real keypress
        // is trusted; a scripted click is not.
        onClick={(event) => {
          if (open) {
            close();
            return;
          }
          openedByKeyboard.current = event.detail === 0 && event.isTrusted;
          openMenu();
        }}
        data-tour={triggerDataTour}
        className={triggerClassName ?? TRIGGER_CLASS}
      >
        ⋮
      </button>
      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            id={menuId}
            role="menu"
            aria-label={label}
            data-tour={panelDataTour}
            style={{
              position: "fixed",
              right: position.right,
              ...(position.openUpward
                ? { bottom: position.top, marginBottom: 4 }
                : { top: position.top, marginTop: 4 }),
            }}
            // Any item click closes the menu — items are navigation/action triggers, not
            // something a user picks more than one of per open. Focus goes back to ⋮ first, while
            // the clicked item is still in the page: a dialog the item opens records what had
            // focus when it mounts, and the item is gone by then, so it would record <body> and
            // hand focus back there on close.
            onClick={() => close(true)}
            className="z-50 min-w-[160px] bg-surface border border-line rounded-[3px] shadow-lg py-1 flex flex-col"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
