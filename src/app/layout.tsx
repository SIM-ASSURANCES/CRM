import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/montserrat";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CRM Commercial — SIM Assurances",
    template: "%s — CRM Commercial",
  },
  description: "CRM commercial de SIM Assurances",
  // Application interne : ne pas être indexée par les moteurs de recherche.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
