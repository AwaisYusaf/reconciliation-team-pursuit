import type { Metadata } from "next";

import { LandingPage } from "@/src/modules/landing/landing-page";
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
// the shape search and answer engines read a price out of. Keep the amounts in step with the
// pricing section in landing-page.tsx — they are written in both places for a human to read.
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
    {
      "@type": "Offer",
      name: "Reconciliation",
      price: "297",
      priceCurrency: "USD",
      category: "Single funding source",
      description:
        "Full core ledger and packet generation for one municipal or state grant contract.",
    },
    {
      "@type": "Offer",
      name: "Reconciliation + AI",
      price: "497",
      priceCurrency: "USD",
      category: "Multiple funding sources",
      description:
        "Everything in Reconciliation, plus multiple contracts and the AI monthly funding and program summary.",
    },
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
