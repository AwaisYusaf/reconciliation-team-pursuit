import type { MetadataRoute } from "next";

const siteUrl = process.env.APP_URL ?? "https://stayfunded360.com";

// Only the public pages: the landing page and the two legal pages. /r and /a are auth-gated and
// don't belong in a sitemap.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    // The legal pages change rarely; their own "Last updated" date is what matters to a reader.
    { url: `${siteUrl}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${siteUrl}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
