import type { Metadata } from "next";

import { LandingPage } from "@/src/modules/landing/landing-page";

// Ported from grant-ledger app/layout.tsx (lines 18-56) with the site URL swapped to this
// repo's own convention: APP_URL, not grant-ledger's NEXT_PUBLIC_SITE_URL.
const siteUrl = process.env.APP_URL ?? "https://reconciliation.teampursuit.org";
const title = "Grant Ledger | Frontline Nonprofit Grant Reconciliation & Audit Engine";
const description =
  "Capture every grant expense with its documentation the moment it happens, then generate a complete funder-ready packet, cover sheets, contract summary, and merged filing, in minutes. Built for CVI and frontline nonprofits managing municipal grant reimbursements.";

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
    siteName: "Grant Ledger",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/macbook-pro-14-front.png",
        width: 1200,
        height: 780,
        alt: "Grant Ledger dashboard shown on a laptop screen",
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
  name: "Grant Ledger",
  url: siteUrl,
  logo: `${siteUrl}/favicon.ico`,
  description,
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
      <LandingPage />
    </div>
  );
}
