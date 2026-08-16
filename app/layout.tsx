import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Grant Expense Reconciliation",
  description: "Monthly grant expense reconciliation and packet preparation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
