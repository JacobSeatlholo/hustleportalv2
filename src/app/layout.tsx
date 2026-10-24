import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import GaAnalytics from "@/components/hp/GaAnalytics";

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

// Structured data for search engines and AI answer engines.
// Facts only: real plans (src/lib/plans.ts), real contact details from the
// public company footprint. No invented awards, ratings or reviews.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://www.hustleportal.online/#business",
      "name": "Business Hustle",
      "legalName": "Simple Eternity Holdings (Pty) Ltd",
      "alternateName": ["HustlePortal", "HustlePortal™", "Business Hustle SA"],
      "description":
        "South African business growth platform for entrepreneurs, startups and SMEs. AI business planning, lead sourcing, client management, digital marketing tools and expert services from Cape Town.",
      "url": "https://www.hustleportal.online",
      "logo": "https://www.hustleportal.online/icon-512.png",
      "image": "https://www.hustleportal.online/og-image.png",
      "telephone": "+27744815163",
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Cape Town",
        "addressRegion": "Western Cape",
        "postalCode": "8001",
        "addressCountry": "ZA",
      },
      "areaServed": { "@type": "Country", "name": "South Africa" },
      "sameAs": [
        "https://www.businesshustle.co.za",
        "https://x.com/TeeJaySeatlholo",
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://www.hustleportal.online/#website",
      "url": "https://www.hustleportal.online/",
      "name": "HustlePortal",
      "description":
        "The Business OS for South African entrepreneurs. Leads, clients, invoicing, tasks and finance in one professional system.",
      "inLanguage": "en-ZA",
      "publisher": { "@id": "https://www.hustleportal.online/#business" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://www.hustleportal.online/#app",
      "name": "HustlePortal",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web, iOS, Android",
      "description":
        "Business OS for South African entrepreneurs: AI lead sourcing with verified contact reveals, client management, invoicing, tasks, inventory, finance and AI business plans in one web app.",
      "url": "https://www.hustleportal.online/",
      "image": "https://www.hustleportal.online/og-image.png",
      "inLanguage": "en-ZA",
      "publisher": { "@id": "https://www.hustleportal.online/#business" },
      "offers": [
        {
          "@type": "Offer",
          "name": "Free account",
          "price": "0",
          "priceCurrency": "ZAR",
          "description": "R99 in free lead credits. Every tool included. No card required.",
        },
        {
          "@type": "Offer",
          "name": "Operator",
          "price": "199.00",
          "priceCurrency": "ZAR",
          "description": "Monthly verified lead reveal credits (launch special, standard R299).",
        },
        {
          "@type": "Offer",
          "name": "Boss",
          "price": "499.00",
          "priceCurrency": "ZAR",
          "description": "Larger monthly reveal quota, the best per lead price.",
        },
      ],
      "featureList": [
        "AI lead sourcing",
        "Verified contact reveals",
        "Client management (CRM)",
        "Invoicing and finance",
        "Tasks and inventory",
        "AI business plan generator",
        "Mail and calendar",
        "Done for you expert services",
      ],
    },
  ],
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {children}
        <Toaster />
        <GaAnalytics />
      </body>
    </html>
  );
}
