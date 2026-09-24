"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/src/lib/cn";

/**
 * The nine primary tabs, in the order the client approved.
 *
 * Two shapes, one list. From `lg` they are a centred pill of tabs; below that they collapse
 * behind a menu button, because nine tabs cannot fit a phone and a sideways-scrolling row
 * hides most of them behind a gesture nobody thinks to try.
 */
export const NAV_ITEMS = [
  { label: "Dashboard", href: "/r" },
  { label: "Add Expense", href: "/r/expenses/new" },
  { label: "Expenses", href: "/r/expenses" },
  { label: "Cover Sheets", href: "/r/cover-sheets" },
  { label: "Recurring", href: "/r/recurring" },
  { label: "Month-End Packet", href: "/r/packet" },
  { label: "Contract Summary", href: "/r/contract-summary" },
  { label: "Line Items", href: "/r/line-items" },
  { label: "Settings", href: "/r/settings" },
] as const;

/**
 * Bring the active tab into view in the scrolled row.
 *
 * `nearest` rather than `center` so a tab already visible is left alone — otherwise every
 * navigation would jerk the row sideways for no reason.
 */
function scrollActiveIntoView(node: HTMLAnchorElement | null): void {
  node?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** Exported for `tour-replay-button.tsx`, which resolves the current tab's tour the same way
 *  this nav resolves its own active tab — same "longest href wins" rule, same edge cases. */
export function matches(pathname: string, href: string): boolean {
  if (href === "/r") return pathname === "/r";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The pill shell, shared by the desktop track and the mobile menu button.
 *
 * Dark brown, with the current tab reversed out of it in white. Both directions clear AA with
 * room to spare — white on `accent-dark` is about 13:1, and the white pill carries the brown
 * back as its text — so the strongest contrast on the bar is what marks where you are.
 */
const PILL = "surface-dark rounded-full bg-accent-dark shadow-[0_2px_12px_rgba(33,27,22,0.18)]";

export function AppNav() {
  const pathname = usePathname();
  // Longest matching href wins, so /expenses/new lights up "Add Expense" rather than
  // also matching "Expenses".
  const activeHref = NAV_ITEMS.filter((item) => matches(pathname, item.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0]?.href;
  const activeLabel = NAV_ITEMS.find((item) => item.href === activeHref)?.label ?? "Menu";

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    // No tour anchor here. The Dashboard's "Add Expense" step used to point at this wrapper,
    // which is the whole nav — so the spotlight opened over the entire tab bar rather than
    // over anything to do with adding an expense. It now anchors on the Dashboard's own
    // "Add Expense" button (`app/r/source-budget-section.tsx`), which is a real, visible
    // control at every width and is actually the thing the step is describing.
    <div>
      {/* Phone, tablet and laptop: a menu button naming the current screen. */}
      <div ref={wrapperRef} className="relative xl:hidden">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={cn(PILL, "flex items-center gap-2 px-3 py-2 max-w-full")}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="w-4 h-4 flex-none text-surface"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
          </svg>
          {/* The current screen's name doubles as the button's label, so the control says
              where you are as well as offering to move. */}
          <span className="text-[14px] font-bold text-surface truncate">{activeLabel}</span>
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Primary"
            className="absolute left-0 top-full mt-2 z-40 w-[240px] max-w-[calc(100vw-2rem)] bg-surface border border-line rounded-[10px] shadow-lg overflow-hidden pop-in"
          >
            {NAV_ITEMS.map((item) => {
              const active = item.href === activeHref;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  aria-current={active ? "page" : undefined}
                  // Closed here rather than by watching the path: a route change does not
                  // unmount this menu, so it would otherwise stay open over the screen the
                  // person just picked.
                  onClick={() => setOpen(false)}
                  className={cn(
                    "block w-full min-h-11 flex items-center px-3.5 text-[15px] hover:bg-section",
                    active ? "bg-section font-bold text-ink" : "text-sub",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* From `xl`: all nine as one centred pill. */}
      <nav
        className="hidden xl:flex py-1"
        aria-label="Primary"
      >
        {/*
          `w-max` so the track sizes to its tabs rather than to the row, and `mx-auto` to
          centre it. 14px with 10px side padding puts it at roughly 945px against the ~995px
          the row has once the mark and the account controls are taken out, so all nine fit
          down to about a 1180px viewport and the row scrolls below that.
        */}
        <div className={cn(PILL, "flex items-center gap-0.5 w-max mx-auto p-1")}>
          {NAV_ITEMS.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                ref={active ? scrollActiveIntoView : undefined}
                className={cn(
                  "rounded-full px-2.5 py-2 text-[14px] whitespace-nowrap",
                  active
                    ? "bg-surface text-accent font-bold"
                    : // No hover pill and no fade: the white pill marks where you are, and a
                      // second lit-up pill under the cursor competes with it. The label
                      // brightening to full white is the whole hover affordance — a nav link
                      // with no hover response at all reads as not clickable.
                      "text-surface/75 font-medium hover:text-surface",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
