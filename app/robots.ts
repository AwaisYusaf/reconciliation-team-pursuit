import type { MetadataRoute } from "next";

const siteUrl = process.env.APP_URL ?? "https://reconciliation.teampursuit.org";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
