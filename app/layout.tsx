import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Grant expense tracking, reconciliation and monthly packet preparation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="bg-paper text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
