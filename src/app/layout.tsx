import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { ThemeRegistry } from "@/components/ThemeRegistry";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "aggcenter",
  description:
    "Operational aggregation center — cash position, reconciliation, supplier master-data quality, invoice parsing, and people documents.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${inter.className} h-full antialiased`}>
      <body className="min-h-full">
        <ThemeRegistry>
          <AppShell>{children}</AppShell>
        </ThemeRegistry>
      </body>
    </html>
  );
}
