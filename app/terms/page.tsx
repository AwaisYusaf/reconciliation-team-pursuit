import type { Metadata } from "next";

import { APP_NAME } from "@/src/domain/strings";
import { LegalPage } from "@/src/modules/legal/legal-page";
import { TERMS_OF_SERVICE } from "@/src/modules/legal/terms";

// Prerendered at build time, when the production .env isn't there yet: the same fallback as the
// landing page, robots.ts and sitemap.ts (see `src/lib/site-url.ts`).
const siteUrl = process.env.APP_URL ?? "https://stayfunded360.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: `Terms of Service | ${APP_NAME}`,
  description: "The terms that govern using Stay Funded 360: plans, billing, your data, acceptable use and more.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

/** Public, no sign-in: linked from the landing page's footer and from sign-up. */
export default function Page() {
  return (
    <div className="lp bg-lp-surface text-on-surface font-lp-sans antialiased selection:bg-brand-700 selection:text-white min-h-screen">
      <LegalPage document={TERMS_OF_SERVICE} />
    </div>
  );
}
