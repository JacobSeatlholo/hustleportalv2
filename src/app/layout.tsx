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
  metadataBase: new URL("https://hustleportal.online"),
  title: "HustlePortal™ — Business OS for South African Entrepreneurs",
  description:
    "Leads, clients, invoicing, tasks and finance in one professional system. Source leads with AI, reveal verified contacts with prepaid credits. Built in South Africa.",
  keywords: [
    "HustlePortal", "Business Hustle", "leads South Africa", "CRM for entrepreneurs",
    "AI business plan", "SME tools South Africa", "business OS", "township economy",
  ],
  authors: [{ name: "Business Hustle — Simple Eternity Holdings (Pty) Ltd" }],
  manifest: "/manifest.webmanifest",
  applicationName: "HustlePortal",
  appleWebApp: {
    capable: true,
    title: "HustlePortal",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "HustlePortal™ — Business OS for South African Entrepreneurs",
    description: "Run your business like a business. Leads, CRM, invoicing, tasks, finance & AI — built for South African businesses.",
    siteName: "HustlePortal",
    type: "website",
    locale: "en_ZA",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  viewportFit: "cover",
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
