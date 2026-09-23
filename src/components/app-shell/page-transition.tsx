"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Replays the content's entrance on every navigation.
 *
 * The animation lives in a CSS class, and a class only runs its animation when the element
 * mounts. In the App Router the layout — and so this element — persists across navigations
 * while only the page segment below it changes, so without a key the entrance would play once
 * on the first load and never again.
 *
 * `key={pathname}` is what makes React tear the wrapper down and build a new one per route,
 * which is the mount the animation needs.
 *
 * A client component that renders server children: `children` is passed in already rendered,
 * so nothing below this becomes a client component by being wrapped in it. The only thing
 * this adds to the bundle is the hook that reads the path.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="rise-in">
      {children}
    </div>
  );
}
