import type { Metadata } from "next";

import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "aggcenter · Cash Position",
  description:
    "Operational aggregation center — bank statement reconciliation, cash position and anomaly detection for Order-to-Cash and Procure-to-Pay.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
