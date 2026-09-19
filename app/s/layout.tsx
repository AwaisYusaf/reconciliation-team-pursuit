import type { Metadata } from "next";

import { APP_NAME } from "@/src/domain/strings";

/**
 * Shared links (PHASE-12, D-112) — the only pages in the app anyone can open without an account.
 * Never indexed and never leaking the token in a Referer (P17; `next.config.ts` sends the same
 * rules as headers). No `loading.tsx` and no Suspense anywhere under `app/s`: a 404 status only
 * survives if `notFound()` runs before the response starts streaming.
 */
export const metadata: Metadata = {
  title: APP_NAME,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** The sign-in pages' centred paper shell (`app/(auth)/layout.tsx`). */
export default function SharedLinkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper flex items-start justify-center px-4 sm:px-6 py-8 sm:py-16">
      {children}
    </div>
  );
}
