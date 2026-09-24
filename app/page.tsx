import type { Metadata } from "next";

import { LandingPage } from "@/src/modules/landing/landing-page";
import { type PlanKey, PLANS } from "@/src/modules/landing/plans";
import { APP_NAME } from "@/src/domain/strings";

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
    // A real 1200x630 render of the page's own first screen (64 KB). The laptop PNG this used
    // to name is 3944x2564, 4.5 MB and transparent, so previews either timed out or showed it
    // on black; its declared 1200x780 was not its size either.
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: `The ${APP_NAME} home page: the headline beside the dashboard on a laptop screen`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og-image.jpg"],
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
// the shape search and answer engines read a price out of. Names and amounts come from the same
// `PLANS` the pricing cards print, so the two cannot disagree.
//
// The price alone read as a one-off $297. `UnitPriceSpecification` with `MON` (UN/CEFACT's code
// for a month) is how schema.org says "per month", which is what the page says.
function planOffer(plan: PlanKey, category: string, description: string) {
  const price = String(PLANS[plan].monthlyUsd);
  return {
    "@type": "Offer",
    name: PLANS[plan].name,
    price,
    priceCurrency: "USD",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price,
      priceCurrency: "USD",
      unitCode: "MON",
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
    },
    category,
    description,
  };
}

const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: APP_NAME,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Grant management and funding compliance",
  operatingSystem: "Web browser",
  url: siteUrl,
  description,
  offers: [
    planOffer(
      "reconciliation",
      "Single funding source",
      "Full core ledger and packet generation for one municipal or state grant contract.",
    ),
    planOffer(
      "reconciliationAi",
      "Multiple funding sources",
      `Everything in ${PLANS.reconciliation.name}, plus multiple contracts and the AI monthly funding and program summary.`,
    ),
  ],
};

// Scoped here rather than the root layout: /r and /a are not marketing pages and should not
// carry the landing's JSON-LD or its marketing type scale (see globals.css's `.lp` scoping).
export default function Home() {
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
      <LandingPage />
    </div>
  );
}
