import type { MetadataRoute } from 'next'

// Canonical host is www — the apex 308 redirects there.
export const SITE = 'https://www.hustleportal.online'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE}/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ]
}
