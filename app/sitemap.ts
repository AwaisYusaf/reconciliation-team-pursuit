import type { MetadataRoute } from "next";

const siteUrl = process.env.APP_URL ?? "https://stayfunded360.com";

// Only the public landing URL — /r and /a are auth-gated and don't belong in a sitemap.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
