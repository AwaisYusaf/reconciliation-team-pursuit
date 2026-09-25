import type { Metadata } from "next";
import { connection } from "next/server";

import { LandingPage } from "@/src/modules/landing/landing-page";
import { APP_NAME } from "@/src/domain/strings";
import { PRICES_CENTS } from "@/src/modules/billing/pricing";
import { signupEnabled } from "@/src/modules/auth/config";

// Ported from grant-ledger app/layout.tsx (lines 18-56) with the site URL swapped to this
// repo's own convention: APP_URL, not grant-ledger's NEXT_PUBLIC_SITE_URL.
const siteUrl = process.env.APP_URL ?? "https://stayfunded360.com";
const title = `${APP_NAME} | Funding Accountability & Readiness Platform`;
// Kept under ~155 characters: past that, search results truncate the sentence mid-thought.
const description =
  "Track, document, and stay compliant with the funding you receive, throughout the funding period, not just at reconciliation. Award to audit readiness.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: APP_NAME,
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/macbook-pro-14-front.png",
        width: 1200,
        height: 780,
        alt: `${APP_NAME} dashboard shown on a laptop screen`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/macbook-pro-14-front.png"],
  },
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: APP_NAME,
  url: siteUrl,
  logo: `${siteUrl}/brand/stayfunded-logo.png`,
  description,
};

// The two plans are stated in full on the page, so they belong in structured data too: this is
// the shape search and answer engines read a price out of. Prices come from PRICES_CENTS
// (src/modules/billing/pricing.ts) — the only place a price literal lives (U-19) — so this and
// the pricing section in landing-page.tsx can never disagree about the amount, only the wording.
const OFFER_COPY: Record<
  keyof typeof PRICES_CENTS,
  { name: string; category: string; description: string }
> = {
  reconciliation: {
    name: "Reconciliation",
    category: "Single funding source",
    description: "Full core ledger and packet generation for one municipal or state grant contract.",
  },
  reconciliation_ai: {
    name: "Reconciliation + AI",
    category: "Multiple funding sources",
    description:
      "Everything in Reconciliation, plus multiple contracts and the AI monthly funding and program summary.",
  },
};

const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: APP_NAME,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Grant management and funding compliance",
  operatingSystem: "Web browser",
  url: siteUrl,
  description,
  offers: Object.entries(PRICES_CENTS).map(([plan, prices]) => {
    const monthly = (prices.month / 100).toFixed(2);
    const yearly = (prices.year / 100).toFixed(2);
    return {
      "@type": "Offer",
      ...OFFER_COPY[plan as keyof typeof PRICES_CENTS],
      price: monthly,
      priceCurrency: "USD",
      priceSpecification: [
        { "@type": "UnitPriceSpecification", price: monthly, priceCurrency: "USD", billingDuration: "P1M", unitCode: "MON" },
        { "@type": "UnitPriceSpecification", price: yearly, priceCurrency: "USD", billingDuration: "P1Y", unitCode: "ANN" },
      ],
    };
  }),
};

// Scoped here rather than the root layout: /r and /a are not marketing pages and should not
// carry the landing's JSON-LD or its marketing type scale (see globals.css's `.lp` scoping).
export default async function Home() {
  // Reads SIGNUP_ENABLED at request time, not baked in at build (Phase 7): a deploy that
  // flips it must not require a rebuild to show up here.
  await connection();

  return (
    <div className="lp bg-lp-surface text-on-surface font-lp-sans antialiased selection:bg-brand-700 selection:text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(organizationSchema).replace(/</g, "\\u003c"),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareSchema).replace(/</g, "\\u003c"),
        }}
      />
      <LandingPage prices={PRICES_CENTS} signupOpen={signupEnabled()} />
    </div>
  );
}
