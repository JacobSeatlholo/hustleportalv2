// ============ STRUCTURED DATA (Task 214) ============
// The org/website/app JSON-LD used to live in the root layout, which stamped
// HustlePortal schema onto EVERY route — including the whitelabel partner
// doors and signing pages. It now lives where the brand is right:
//   - BH_JSON_LD: the home page and the generic corporate door.
//   - whitelabelJsonLd(s): a strategist-branded Organization node for partner
//     surfaces, with no reference to the engine.

export const BH_JSON_LD = {
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
    },
  ],
}

import type { Strategist } from '@/lib/corporate'

export function whitelabelJsonLd(s: Strategist) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: s.company,
    description: `${s.tagline} Verified leads for corporate sales floors, presented by ${s.name}.`,
    url: `https://www.hustleportal.online/corporate/${s.slug}`,
    logo: `https://www.hustleportal.online${s.image}`,
  }
}
