"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/src/lib/cn";

/**
 * The nine primary tabs, in the order the client approved.
 * Active tab: bold ink with a 3px accent underline; inactive: secondary text.
 */
export const NAV_ITEMS = [
  { label: "Dashboard", href: "/" },
  { label: "Add Expense", href: "/expenses/new" },
  { label: "Expenses", href: "/expenses" },
  { label: "Cover Sheets", href: "/cover-sheets" },
  { label: "Recurring", href: "/recurring" },
  { label: "Month-End Packet", href: "/packet" },
  { label: "Contract Summary", href: "/contract-summary" },
  { label: "Line Items", href: "/line-items" },
  { label: "Settings", href: "/settings" },
] as const;

function matches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
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
    <nav className="flex flex-wrap gap-6 mt-[18px]" aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "pt-3 pb-[13px] text-base border-b-[3px] transition-colors",
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
