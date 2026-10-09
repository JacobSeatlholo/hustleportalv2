import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const displayFont = Bebas_Neue({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HustlePortal™ — Business OS for South African Entrepreneurs",
  description:
    "Leads, clients, tasks and finance in one place. Source leads with AI, reveal contacts with prepaid credits, and level up your hustle. Built in Cape Town for SA.",
  keywords: [
    "HustlePortal", "Business Hustle", "leads South Africa", "CRM for entrepreneurs",
    "AI business plan", "SME tools South Africa", "business OS", "township economy",
  ],
  authors: [{ name: "Business Hustle — Simple Eternity Holdings (Pty) Ltd" }],
  openGraph: {
    title: "HustlePortal™ — Business OS for South African Entrepreneurs",
    description: "Your hustle, levelled up. Leads, CRM, tasks, finance & AI — built for SA.",
    siteName: "HustlePortal",
    type: "website",
    locale: "en_ZA",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a1812",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-ZA" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${displayFont.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
