import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded by Node at runtime rather than bundled: its libheif WASM build is large and gains
  // nothing from bundling (HEIC uploads, `src/services/storage/inspect.ts`).
  serverExternalPackages: ["heic-decode"],
};

export default nextConfig;
