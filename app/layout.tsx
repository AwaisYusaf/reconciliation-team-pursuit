import type { Metadata } from "next";
import { Domine, Public_Sans } from "next/font/google";

import "./globals.css";

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
  title: "Grant Expense Reconciliation",
  description: "Monthly grant expense reconciliation and packet preparation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${domine.variable} ${publicSans.variable}`}>
      <body className="bg-paper text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
