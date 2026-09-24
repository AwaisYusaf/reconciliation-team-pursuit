import type { Metadata } from "next";
import { Domine, Public_Sans } from "next/font/google";
import localFont from "next/font/local";

import { APP_NAME } from "@/src/domain/strings";

import "./globals.css";

/**
 * Plus Jakarta Sans — the application's typeface.
 *
 * Self-hosted from `app/fonts` rather than `next/font/google`: the variable files were
 * supplied with the design, and the OFL licence they ship under is kept beside them so the
 * attribution travels with the files. One variable font covers 200–800, so every weight the
 * UI uses costs one download rather than one per weight.
 */
const jakarta = localFont({
  variable: "--font-jakarta",
  display: "swap",
  src: [
    { path: "./fonts/PlusJakartaSans-VariableFont_wght.ttf", weight: "200 800", style: "normal" },
    {
      path: "./fonts/PlusJakartaSans-Italic-VariableFont_wght.ttf",
      weight: "200 800",
      style: "italic",
    },
  ],
});

// Loaded here (not in the landing route) because next/font/google requires a module-scope
// call, and this is the shared ancestor of every route including /page.tsx.
const domine = Domine({
  variable: "--font-domine",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Grant expense tracking, reconciliation and monthly packet preparation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${domine.variable} ${publicSans.variable} ${jakarta.variable}`}
    >
      <body className="bg-paper text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
