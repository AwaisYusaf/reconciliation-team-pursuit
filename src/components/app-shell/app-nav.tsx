"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/src/lib/cn";

/**
 * The nine primary tabs, in the order the client approved.
 * Active tab: bold ink with a 3px accent underline; inactive: secondary text.
 *
 * On a phone the row scrolls sideways instead of wrapping. Wrapping put nine links on four
 * ragged rows and made the header 545px tall — two thirds of a 812px screen before a single
 * figure appeared. Scrolling keeps the header one row high at every width, and the active
 * tab is scrolled into view on load so the user can see where they are.
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

export function AppNav() {
  const pathname = usePathname();
  // Longest matching href wins, so /expenses/new lights up "Add Expense" rather than
  // also matching "Expenses".
  const activeHref = NAV_ITEMS.filter((item) => matches(pathname, item.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0]?.href;

  return (
    <nav
      // The negative margin lets the scrolled row bleed to the screen edges, so a partially
      // visible tab reads as "there is more this way" rather than as a clipped mistake.
      // Top spacing is the wrapper's own padding-top in layout.tsx, not a margin here: a
      // margin on this nav's box doesn't get painted with its sticky wrapper's background,
      // which showed as a gap of bare page background between the header above and this bar.
      className="-mx-4 sm:mx-0 px-4 sm:px-0 flex gap-5 sm:gap-6 overflow-x-auto lg:flex-wrap lg:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Primary"
    >
      {NAV_ITEMS.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            ref={active ? scrollActiveIntoView : undefined}
            data-tour={item.href === "/r/expenses/new" ? "add-expense-nav" : undefined}
            className={cn(
              "pt-2.5 pb-3 sm:pt-3 sm:pb-[13px] text-[15px] sm:text-base border-b-[3px] transition-colors whitespace-nowrap",
              active
                ? "text-ink font-bold border-accent"
                : "text-sub font-normal border-transparent hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
