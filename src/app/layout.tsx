import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import GaAnalytics from "@/components/hp/GaAnalytics";
import PostHogAnalytics from "@/components/hp/PostHogAnalytics";

// Bold & confident display — condensed caps, poster energy. This IS the brand voice.
// (Anti-slop work lives in the warm ink neutrals + mono eyebrows, not the font.)
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
  // Canonical host is www, the apex 308 redirects there.
  metadataBase: new URL("https://www.hustleportal.online"),
  title: "HustlePortal™, Business OS for South African Entrepreneurs",
  description:
    "Leads, clients, invoicing, tasks and finance in one professional system. Source leads with AI, reveal verified contacts with prepaid credits. Built in South Africa.",
  keywords: [
    "HustlePortal", "Business Hustle", "leads South Africa", "CRM for entrepreneurs",
    "AI business plan", "SME tools South Africa", "business OS", "township economy",
  ],
  authors: [{ name: "Business Hustle, Simple Eternity Holdings (Pty) Ltd" }],
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
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: "HustlePortal™, Business OS for South African Entrepreneurs",
    description: "Run your business like a business. Leads, CRM, invoicing, tasks, finance & AI, built for South African businesses.",
    url: "/",
    siteName: "HustlePortal",
    type: "website",
    locale: "en_ZA",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "HustlePortal, the Business OS for South African Entrepreneurs",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "HustlePortal™, Business OS for South African Entrepreneurs",
    description: "Run your business like a business. Leads, CRM, invoicing, tasks, finance & AI, built for South African businesses.",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0c0a",
  viewportFit: "cover",
};

// Theme pre-paint: reads the saved display choice before first render so
// Calm mode never flashes. Console (default) vs Calm (lower contrast).
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('hp_theme');if(t==='calm'){document.documentElement.classList.add('calm');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-ZA" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${displayFont.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <GaAnalytics />
        <PostHogAnalytics />
      </body>
    </html>
  );
}
