import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded by Node at runtime rather than bundled: its libheif WASM build is large and gains
  // nothing from bundling (HEIC uploads, `src/services/storage/inspect.ts`).
  serverExternalPackages: ["heic-decode"],

  async headers() {
    return [
      {
        // Shared links and their password page must never appear in search results, and the token
        // in the URL must never leave in a Referer header (PHASE-12 P17). A header rather than a
        // robots.txt Disallow: a crawler blocked by robots.txt never fetches the page, so never
        // sees the noindex, and can still list the bare URL. The routes also set these themselves.
        source: "/s/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
